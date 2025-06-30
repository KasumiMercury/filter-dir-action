import * as core from "@actions/core";
import * as github from "@actions/github";
import * as fs from "fs";
import * as path from "path";

export interface PullRequestFile {
  filename: string;
  status: string;
}

export interface GitHubContext {
  repo: {
    owner: string;
    repo: string;
  };
  payload: {
    pull_request?: {
      number: number;
    };
  };
}

export function parseManualDirectories(input: string): string[] {
  if (!input.trim()) {
    return [];
  }
  
  return input
    .split(',')
    .map(dir => dir.trim())
    .filter(dir => dir.length > 0);
}

export function getManualTargetDirectories(
  manualDirectories: string[],
  availableDirectories: string[]
): string[] {
  if (manualDirectories.length === 0) {
    return availableDirectories;
  }
  
  return manualDirectories.filter(dir => availableDirectories.includes(dir));
}

export async function getChangedFiles(token: string, context: GitHubContext): Promise<string[]> {
  if (!context.payload.pull_request) {
    throw new Error("This action only works on pull requests");
  }

  const octokit = github.getOctokit(token);
  
  const { data: files } = await octokit.rest.pulls.listFiles({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: context.payload.pull_request.number,
  });

  return files.map((file: PullRequestFile) => file.filename);
}

export function getSubdirectories(targetPath: string): string[] {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Target directory does not exist: ${targetPath}`);
  }

  return fs.readdirSync(targetPath, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);
}

export function filterDirectoriesWithChanges(
  subdirectories: string[],
  changedFiles: string[],
  targetParentPath: string
): string[] {
  const dirsWithChanges: string[] = [];

  for (const dir of subdirectories) {
    const dirPath: string = path.join(targetParentPath, dir);
    const hasChangedFiles: boolean = changedFiles.some((file: string) => {
      return file.startsWith(dirPath + path.sep) || file === dirPath;
    });

    if (hasChangedFiles) {
      dirsWithChanges.push(dir);
    }
  }

  return dirsWithChanges;
}

export async function main(): Promise<void> {
  const targetParentPath: string = core.getInput("target-parent-path");
  const token: string = core.getInput("github-token") || process.env.GITHUB_TOKEN || "";
  const manualDirectoriesInput: string = core.getInput("manual-directories");
  
  const context = github.context as GitHubContext;
  const targetPath: string = path.resolve(targetParentPath);
  const subdirectories: string[] = getSubdirectories(targetPath);
  core.debug(`Found ${subdirectories.length} subdirectories: ${JSON.stringify(subdirectories)}`);

  let result: string[];

  if (manualDirectoriesInput || !context.payload.pull_request) {
    core.info("Running in manual mode");
    
    const manualDirectories: string[] = parseManualDirectories(manualDirectoriesInput);
    core.debug(`Manual directories input: ${JSON.stringify(manualDirectories)}`);
    
    result = getManualTargetDirectories(manualDirectories, subdirectories);
    core.info(`Manual target directories: ${JSON.stringify(result)}`);
  } else {
    core.info("Running in pull request mode");
    
    if (!token) {
      throw new Error("GitHub token is required for pull request mode");
    }
    
    const changedFiles: string[] = await getChangedFiles(token, context);
    core.info(`Found ${changedFiles.length} changed files`);
    core.debug(`Changed files: ${JSON.stringify(changedFiles)}`);

    result = filterDirectoriesWithChanges(
      subdirectories,
      changedFiles,
      targetParentPath
    );
    core.info(`Directories with changes: ${JSON.stringify(result)}`);
  }

  const resultJson: string = JSON.stringify(result);
  core.setOutput("filtered-dir-path", resultJson);
}

// Only run main if this is the entry point (not during testing)
if (process.env.NODE_ENV !== 'test') {
  try {
    main();
  } catch (error: unknown) {
    const errorMessage: string = error instanceof Error ? error.message : String(error);
    core.setFailed(errorMessage);
  }
}