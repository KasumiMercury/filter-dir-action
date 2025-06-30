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
      const relativePath: string = path.relative(process.cwd(), file);
      return relativePath.startsWith(dirPath + path.sep) || relativePath === dirPath;
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
  
  if (!token) {
    throw new Error("GitHub token is required");
  }

  const context = github.context as GitHubContext;
  
  const changedFiles: string[] = await getChangedFiles(token, context);
  core.info(`Found ${changedFiles.length} changed files`);

  const targetPath: string = path.resolve(targetParentPath);
  const subdirectories: string[] = getSubdirectories(targetPath);

  const dirsWithChanges: string[] = filterDirectoriesWithChanges(
    subdirectories,
    changedFiles,
    targetParentPath
  );

  const result: string = JSON.stringify(dirsWithChanges);
  core.info(`Directories with changes: ${result}`);
  core.setOutput("filtered-dir-path", result);
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