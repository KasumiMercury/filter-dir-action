const core = require("@actions/core");
const github = require("@actions/github");
const fs = require("fs");
const path = require("path");

async function main() {
  const targetParentPath = core.getInput("target-parent-path");
  const token = core.getInput("github-token") || process.env.GITHUB_TOKEN;
  
  if (!token) {
    throw new Error("GitHub token is required");
  }

  const context = github.context;
  if (!context.payload.pull_request) {
    throw new Error("This action only works on pull requests");
  }

  const octokit = github.getOctokit(token);
  
  const { data: files } = await octokit.rest.pulls.listFiles({
    owner: context.repo.owner,
    repo: context.repo.repo,
    pull_number: context.payload.pull_request.number,
  });

  const changedFiles = files.map(file => file.filename);
  core.info(`Found ${changedFiles.length} changed files`);

  const targetPath = path.resolve(targetParentPath);
  
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Target directory does not exist: ${targetPath}`);
  }

  const subdirectories = fs.readdirSync(targetPath, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  const dirsWithChanges = [];

  for (const dir of subdirectories) {
    const dirPath = path.join(targetParentPath, dir);
    const hasChangedFiles = changedFiles.some(file => {
      const relativePath = path.relative(process.cwd(), file);
      return relativePath.startsWith(dirPath + path.sep) || relativePath === dirPath;
    });

    if (hasChangedFiles) {
      dirsWithChanges.push(dir);
    }
  }

  const result = JSON.stringify(dirsWithChanges);
  core.info(`Directories with changes: ${result}`);
  core.setOutput("filtered-dir-path", result);
}

try {
  main();
} catch (error) {
  core.setFailed(error.message);
}
