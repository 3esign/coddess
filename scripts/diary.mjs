import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execSync } from 'node:child_process';

const diaryPath = path.join(process.cwd(), 'DEVELOPMENT_DIARY.md');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function getGitUser() {
  try {
    return execSync('git config user.name').toString().trim();
  } catch {
    return '';
  }
}

const defaultName = getGitUser() || 'Developer';

rl.question(`Enter your name [${defaultName}]: `, (name) => {
  const author = name.trim() || defaultName;
  rl.question('What did you do / what are you working on? ', (message) => {
    if (!message.trim()) {
      console.log('Diary entry cannot be empty.');
      rl.close();
      return;
    }
    
    const dateStr = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    const entry = `
## ${dateStr} | ${author}
- **Action**: Interaction Sign-in
- **Details**: ${message.trim()}
`;
    
    fs.appendFileSync(diaryPath, entry);
    console.log('Diary signed successfully!');
    rl.close();
  });
});
