# Coddess Project Rules & Wisdom

This file contains rules and structural details that guide software-building agents working inside this project. Read this before modifying the codebase.

## 1. Port Configuration
- The Vite frontend is configured to run on port `8922` by default.
- The Fastify backend server is configured to run on port `8921` by default.
- Always check the environment variables `process.env.VITE_PORT` and `process.env.CODDESS_PORT` in `apps/web/vite.config.ts` and `apps/server/src/config.ts` respectively, as they govern custom port overrides.
- Do NOT revert ports back to `5173` or `3001` as they are frequently occupied on the host machine.

## 2. Directory Picker Dialogs (Crucial headless constraint)
- Do NOT use native GUI window dialogs (such as PowerShell's `FolderBrowserDialog` or Node native OS file explorer dialogue packages) to select paths.
- Spawning OS GUI elements from Node.js child processes will HANG or FAIL. This is because the backend server is often executed from headless terminal sessions (Session 0) that have no interactive desktop connection.
- Folder selection must be handled entirely in the browser using the custom React `FolderExplorerModal.tsx` talking to the `/api/system/fs/list` and `/api/system/fs/mkdir` endpoints.

## 3. Project Creation
- Adding a project to Coddess will automatically create the folder recursively via `fs.mkdirSync` if it doesn't exist. There is no need to pre-create the folder.

## 4. Development Diary
- We maintain a chronological development diary in `DEVELOPMENT_DIARY.md`.
- Whenever you make changes to this repository, you must sign the diary describing your changes by running the CLI command:
  ```bash
  npm run diary
  ```
