# Filter Directory Action

A GitHub Action that automatically detects directories containing changed files in pull requests.

## Basic Usage

```yaml
- name: Filter changed directories
  id: filter
  uses: ./filter-dir-action
  with:
    target-parent-path: 'apps'

- name: Use filtered directories
  run: echo "Changed directories: ${{ steps.filter.outputs.filtered-dir-path }}"
```

## Manual Directory Selection

```yaml
- name: Filter specific directories
  id: filter
  uses: ./filter-dir-action
  with:
    target-parent-path: 'services'
    manual-directories: 'api,frontend,database'
```

## Inputs

- **`target-parent-path`** (required, default: `'.'`)
  - The parent directory path to scan for subdirectories

- **`github-token`** (optional, default: `${{ github.token }}`)
  - GitHub token for API access

- **`manual-directories`** (optional, default: `''`)
  - Comma-separated list of directory names for manual execution

## Outputs

- **`filtered-dir-path`**
  - JSON array of directory names that contain changed files

## Limitations

- Only scans direct subdirectories (nested directories are not supported)
- Requires repository read permissions for pull request mode
- Path matching is case-sensitive on Linux/macOS