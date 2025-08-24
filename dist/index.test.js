import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { getChangedFiles, getSubdirectories, filterDirectoriesWithChanges, parseManualDirectories, getManualTargetDirectories, main } from './index';
// Mock modules
vi.mock('fs');
vi.mock('path');
vi.mock('@actions/core');
vi.mock('@actions/github');
const mockFs = vi.mocked(fs);
const mockPath = vi.mocked(path);
const mockCore = vi.mocked(core);
const mockGithub = vi.mocked(github);
describe('Filter Directory Action', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.cwd = vi.fn().mockReturnValue('/workspace');
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });
    describe('getChangedFiles', () => {
        it('should fetch and return changed files from GitHub API', async () => {
            const mockFiles = [
                { filename: 'src/app1/file1.ts', status: 'modified' },
                { filename: 'src/app2/file2.ts', status: 'added' },
                { filename: 'docs/README.md', status: 'modified' }
            ];
            const mockOctokit = {
                rest: {
                    pulls: {
                        listFiles: vi.fn().mockResolvedValue({ data: mockFiles })
                    }
                }
            };
            mockGithub.getOctokit.mockReturnValue(mockOctokit);
            const context = {
                repo: { owner: 'testowner', repo: 'testrepo' },
                payload: { pull_request: { number: 123 } }
            };
            const result = await getChangedFiles('mock-token', context);
            expect(mockGithub.getOctokit).toHaveBeenCalledWith('mock-token');
            expect(mockOctokit.rest.pulls.listFiles).toHaveBeenCalledWith({
                owner: 'testowner',
                repo: 'testrepo',
                pull_number: 123
            });
            expect(result).toEqual([
                'src/app1/file1.ts',
                'src/app2/file2.ts',
                'docs/README.md'
            ]);
        });
        it('should throw error when not in pull request context', async () => {
            const context = {
                repo: { owner: 'testowner', repo: 'testrepo' },
                payload: {}
            };
            await expect(getChangedFiles('mock-token', context))
                .rejects.toThrow('This action only works on pull requests');
        });
        it('should handle GitHub API errors', async () => {
            const mockOctokit = {
                rest: {
                    pulls: {
                        listFiles: vi.fn().mockRejectedValue(new Error('API Error'))
                    }
                }
            };
            mockGithub.getOctokit.mockReturnValue(mockOctokit);
            const context = {
                repo: { owner: 'testowner', repo: 'testrepo' },
                payload: { pull_request: { number: 123 } }
            };
            await expect(getChangedFiles('mock-token', context))
                .rejects.toThrow('API Error');
        });
    });
    describe('getSubdirectories', () => {
        it('should return list of subdirectories', () => {
            const mockDirents = [
                { name: 'app1', isDirectory: () => true },
                { name: 'app2', isDirectory: () => true },
                { name: 'file.txt', isDirectory: () => false },
                { name: 'app3', isDirectory: () => true }
            ];
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readdirSync.mockReturnValue(mockDirents);
            const result = getSubdirectories('/test/path');
            expect(mockFs.existsSync).toHaveBeenCalledWith('/test/path');
            expect(mockFs.readdirSync).toHaveBeenCalledWith('/test/path', { withFileTypes: true });
            expect(result).toEqual(['app1', 'app2', 'app3']);
        });
        it('should throw error when target directory does not exist', () => {
            mockFs.existsSync.mockReturnValue(false);
            expect(() => getSubdirectories('/nonexistent/path'))
                .toThrow('Target directory does not exist: /nonexistent/path');
        });
        it('should return empty array when no subdirectories exist', () => {
            const mockDirents = [
                { name: 'file1.txt', isDirectory: () => false },
                { name: 'file2.js', isDirectory: () => false }
            ];
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readdirSync.mockReturnValue(mockDirents);
            const result = getSubdirectories('/test/path');
            expect(result).toEqual([]);
        });
    });
    describe('filterDirectoriesWithChanges', () => {
        beforeEach(() => {
            mockPath.join.mockImplementation((...args) => args.join('/'));
            mockPath.relative.mockImplementation((from, to) => {
                if (from === '/workspace') {
                    return to.replace('/workspace/', '');
                }
                return to;
            });
            Object.defineProperty(mockPath, 'sep', {
                value: '/',
                configurable: true
            });
        });
        it('should filter directories that contain changed files', () => {
            const subdirectories = ['app1', 'app2', 'app3'];
            const changedFiles = [
                'src/app1/file1.ts',
                'src/app3/file3.ts',
                'docs/README.md'
            ];
            const targetParentPath = 'src';
            const result = filterDirectoriesWithChanges(subdirectories, changedFiles, targetParentPath);
            expect(result).toEqual(['app1', 'app3']);
        });
        it('should handle exact directory matches', () => {
            const subdirectories = ['app1', 'app2'];
            const changedFiles = ['src/app1'];
            const targetParentPath = 'src';
            const result = filterDirectoriesWithChanges(subdirectories, changedFiles, targetParentPath);
            expect(result).toEqual(['app1']);
        });
        it('should return empty array when no directories have changes', () => {
            const subdirectories = ['app1', 'app2', 'app3'];
            const changedFiles = ['docs/README.md', 'other/file.ts'];
            const targetParentPath = 'src';
            const result = filterDirectoriesWithChanges(subdirectories, changedFiles, targetParentPath);
            expect(result).toEqual([]);
        });
        it('should handle nested directory paths correctly', () => {
            const subdirectories = ['services', 'components'];
            const changedFiles = [
                'src/services/auth/login.ts',
                'src/components/ui/button.tsx'
            ];
            const targetParentPath = 'src';
            const result = filterDirectoriesWithChanges(subdirectories, changedFiles, targetParentPath);
            expect(result).toEqual(['services', 'components']);
        });
        it('should handle empty inputs', () => {
            expect(filterDirectoriesWithChanges([], [], 'src')).toEqual([]);
            expect(filterDirectoriesWithChanges(['app1'], [], 'src')).toEqual([]);
            expect(filterDirectoriesWithChanges([], ['file.ts'], 'src')).toEqual([]);
        });
    });
    describe('main', () => {
        let mockContext;
        beforeEach(() => {
            mockContext = {
                repo: { owner: 'testowner', repo: 'testrepo' },
                payload: { pull_request: { number: 123 } }
            };
            mockCore.getInput.mockImplementation((name) => {
                switch (name) {
                    case 'target-parent-path':
                        return 'src';
                    case 'github-token':
                        return 'mock-token';
                    default:
                        return '';
                }
            });
            const mockOctokit = {
                rest: {
                    pulls: {
                        listFiles: vi.fn().mockResolvedValue({
                            data: [
                                { filename: 'src/app1/file1.ts', status: 'modified' },
                                { filename: 'src/app2/file2.ts', status: 'added' }
                            ]
                        })
                    }
                }
            };
            mockGithub.getOctokit.mockReturnValue(mockOctokit);
            mockGithub.context = mockContext;
            const mockDirents = [
                { name: 'app1', isDirectory: () => true },
                { name: 'app2', isDirectory: () => true },
                { name: 'app3', isDirectory: () => true }
            ];
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readdirSync.mockReturnValue(mockDirents);
            mockPath.resolve.mockReturnValue('/workspace/src');
            mockPath.join.mockImplementation((...args) => args.join('/'));
            mockPath.relative.mockImplementation((from, to) => {
                return to.replace('/workspace/', '');
            });
            Object.defineProperty(mockPath, 'sep', {
                value: '/',
                configurable: true
            });
        });
        it('should complete full workflow successfully', async () => {
            await main();
            expect(mockCore.getInput).toHaveBeenCalledWith('target-parent-path');
            expect(mockCore.getInput).toHaveBeenCalledWith('github-token');
            expect(mockCore.info).toHaveBeenCalledWith('Found 2 changed files');
            expect(mockCore.info).toHaveBeenCalledWith('Directories with changes: ["app1","app2"]');
            expect(mockCore.setOutput).toHaveBeenCalledWith('filtered-dir-path', '["app1","app2"]');
        });
        it('should throw error when GitHub token is missing', async () => {
            mockCore.getInput.mockImplementation((name) => {
                switch (name) {
                    case 'target-parent-path':
                        return 'src';
                    case 'github-token':
                        return '';
                    default:
                        return '';
                }
            });
            delete process.env.GITHUB_TOKEN;
            await expect(main()).rejects.toThrow('GitHub token is required');
        });
        it('should use GITHUB_TOKEN environment variable when input is empty', async () => {
            process.env.GITHUB_TOKEN = 'env-token';
            mockCore.getInput.mockImplementation((name) => {
                switch (name) {
                    case 'target-parent-path':
                        return 'src';
                    case 'github-token':
                        return '';
                    default:
                        return '';
                }
            });
            await main();
            expect(mockGithub.getOctokit).toHaveBeenCalledWith('env-token');
        });
        it('should handle target directory not existing', async () => {
            mockFs.existsSync.mockReturnValue(false);
            await expect(main()).rejects.toThrow('Target directory does not exist: /workspace/src');
        });
        it('should handle empty results', async () => {
            const mockOctokit = {
                rest: {
                    pulls: {
                        listFiles: vi.fn().mockResolvedValue({
                            data: [{ filename: 'docs/README.md', status: 'modified' }]
                        })
                    }
                }
            };
            mockGithub.getOctokit.mockReturnValue(mockOctokit);
            await main();
            expect(mockCore.info).toHaveBeenCalledWith('Found 1 changed files');
            expect(mockCore.info).toHaveBeenCalledWith('Directories with changes: []');
            expect(mockCore.setOutput).toHaveBeenCalledWith('filtered-dir-path', '[]');
        });
        it('should handle GitHub API failures gracefully', async () => {
            const mockOctokit = {
                rest: {
                    pulls: {
                        listFiles: vi.fn().mockRejectedValue(new Error('GitHub API Error'))
                    }
                }
            };
            mockGithub.getOctokit.mockReturnValue(mockOctokit);
            await expect(main()).rejects.toThrow('GitHub API Error');
        });
    });
    describe('parseManualDirectories', () => {
        it('should parse comma-separated directories correctly', () => {
            const input = 'alpha,beta,gamma,delta';
            const result = parseManualDirectories(input);
            expect(result).toEqual(['alpha', 'beta', 'gamma', 'delta']);
        });
        it('should handle directories with spaces around commas', () => {
            const input = 'alpha, beta,gamma , delta';
            const result = parseManualDirectories(input);
            expect(result).toEqual(['alpha', 'beta', 'gamma', 'delta']);
        });
        it('should handle empty input', () => {
            expect(parseManualDirectories('')).toEqual([]);
            expect(parseManualDirectories('   ')).toEqual([]);
        });
        it('should filter out empty directory names', () => {
            const input = 'alpha,,beta, ,gamma';
            const result = parseManualDirectories(input);
            expect(result).toEqual(['alpha', 'beta', 'gamma']);
        });
        it('should handle single directory', () => {
            const input = 'alpha';
            const result = parseManualDirectories(input);
            expect(result).toEqual(['alpha']);
        });
    });
    describe('getManualTargetDirectories', () => {
        it('should return all available directories when manual list is empty', () => {
            const manualDirectories = [];
            const availableDirectories = ['alpha', 'beta', 'gamma', 'delta'];
            const result = getManualTargetDirectories(manualDirectories, availableDirectories);
            expect(result).toEqual(['alpha', 'beta', 'gamma', 'delta']);
        });
        it('should filter manual directories by available directories', () => {
            const manualDirectories = ['alpha', 'beta', 'gamma', 'delta'];
            const availableDirectories = ['alpha', 'beta', 'other'];
            const result = getManualTargetDirectories(manualDirectories, availableDirectories);
            expect(result).toEqual(['alpha', 'beta']);
        });
        it('should handle no matching directories', () => {
            const manualDirectories = ['nonexistent1', 'nonexistent2'];
            const availableDirectories = ['alpha', 'beta'];
            const result = getManualTargetDirectories(manualDirectories, availableDirectories);
            expect(result).toEqual([]);
        });
        it('should handle empty available directories', () => {
            const manualDirectories = ['alpha', 'beta'];
            const availableDirectories = [];
            const result = getManualTargetDirectories(manualDirectories, availableDirectories);
            expect(result).toEqual([]);
        });
    });
    describe('main - manual mode', () => {
        let mockContext;
        beforeEach(() => {
            mockContext = {
                repo: { owner: 'testowner', repo: 'testrepo' },
                payload: {}
            };
            const mockDirents = [
                { name: 'alpha', isDirectory: () => true },
                { name: 'beta', isDirectory: () => true },
                { name: 'gamma', isDirectory: () => true },
                { name: 'delta', isDirectory: () => true }
            ];
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readdirSync.mockReturnValue(mockDirents);
            mockPath.resolve.mockReturnValue('/workspace/src');
            mockGithub.context = mockContext;
        });
        it('should run in manual mode with specific directories', async () => {
            mockCore.getInput.mockImplementation((name) => {
                switch (name) {
                    case 'target-parent-path':
                        return 'src';
                    case 'manual-directories':
                        return 'alpha,beta,gamma';
                    default:
                        return '';
                }
            });
            await main();
            expect(mockCore.info).toHaveBeenCalledWith('Running in manual mode');
            expect(mockCore.info).toHaveBeenCalledWith('Manual target directories: ["alpha","beta","gamma"]');
            expect(mockCore.setOutput).toHaveBeenCalledWith('filtered-dir-path', '["alpha","beta","gamma"]');
        });
        it('should run in manual mode with all directories when input is empty', async () => {
            mockCore.getInput.mockImplementation((name) => {
                switch (name) {
                    case 'target-parent-path':
                        return 'src';
                    case 'manual-directories':
                        return '';
                    default:
                        return '';
                }
            });
            await main();
            expect(mockCore.info).toHaveBeenCalledWith('Running in manual mode');
            expect(mockCore.info).toHaveBeenCalledWith('Manual target directories: ["alpha","beta","gamma","delta"]');
            expect(mockCore.setOutput).toHaveBeenCalledWith('filtered-dir-path', '["alpha","beta","gamma","delta"]');
        });
        it('should filter directories that exist in target directory', async () => {
            mockCore.getInput.mockImplementation((name) => {
                switch (name) {
                    case 'target-parent-path':
                        return 'src';
                    case 'manual-directories':
                        return 'alpha,beta,nonexistent,gamma';
                    default:
                        return '';
                }
            });
            await main();
            expect(mockCore.info).toHaveBeenCalledWith('Running in manual mode');
            expect(mockCore.info).toHaveBeenCalledWith('Manual target directories: ["alpha","beta","gamma"]');
            expect(mockCore.setOutput).toHaveBeenCalledWith('filtered-dir-path', '["alpha","beta","gamma"]');
        });
        it('should handle manual directories with spaces', async () => {
            mockCore.getInput.mockImplementation((name) => {
                switch (name) {
                    case 'target-parent-path':
                        return 'src';
                    case 'manual-directories':
                        return 'alpha, beta,gamma ,delta';
                    default:
                        return '';
                }
            });
            await main();
            expect(mockCore.info).toHaveBeenCalledWith('Running in manual mode');
            expect(mockCore.info).toHaveBeenCalledWith('Manual target directories: ["alpha","beta","gamma","delta"]');
            expect(mockCore.setOutput).toHaveBeenCalledWith('filtered-dir-path', '["alpha","beta","gamma","delta"]');
        });
    });
    describe('Integration scenarios', () => {
        beforeEach(() => {
            mockPath.join.mockImplementation((...args) => args.join('/'));
            mockPath.relative.mockImplementation((from, to) => {
                if (from === '/workspace') {
                    return to.replace('/workspace/', '');
                }
                return to;
            });
            Object.defineProperty(mockPath, 'sep', {
                value: '/',
                configurable: true
            });
        });
        it('should handle complex directory structure with nested changes', async () => {
            const subdirectories = ['frontend', 'backend', 'shared'];
            const changedFiles = [
                'apps/frontend/src/components/Button.tsx',
                'apps/shared/utils/helpers.ts',
                'docs/README.md'
            ];
            const result = filterDirectoriesWithChanges(subdirectories, changedFiles, 'apps');
            expect(result).toEqual(['frontend', 'shared']);
        });
        it('should handle Windows-style paths', () => {
            Object.defineProperty(mockPath, 'sep', {
                value: '\\',
                configurable: true
            });
            mockPath.join.mockImplementation((...args) => args.join('\\'));
            mockPath.relative.mockImplementation((from, to) => to);
            const subdirectories = ['app1', 'app2'];
            const changedFiles = ['src\\app1\\file.ts'];
            const result = filterDirectoriesWithChanges(subdirectories, changedFiles, 'src');
            expect(result).toEqual(['app1']);
        });
        it('should handle special characters in directory names', () => {
            const subdirectories = ['app-1', 'app_2', 'app.test'];
            const changedFiles = [
                'src/app-1/file.ts',
                'src/app.test/spec.js'
            ];
            const result = filterDirectoriesWithChanges(subdirectories, changedFiles, 'src');
            expect(result).toEqual(['app-1', 'app.test']);
        });
    });
});
