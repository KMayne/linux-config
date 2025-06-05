#!/usr/bin/env node

const { exec, spawn } = require('child_process');

const config = {
  blink: [
    '• Blink',
    [
      '/opt/google/chrome/google-chrome',
      '--profile-directory=Default',
      '--app-id=nbjihfimkbmgnfhjgpinlonjmecnigia'
    ],
    'Jetbrains'
  ],
  chrome: [
    'google-chrome',
    ['/usr/bin/google-chrome-stable'],
    "• Blink"
  ],
  code: [
    'Visual Studio Code',
    ['/usr/share/code/code']
  ],
  datagrip: [
    'jetbrains-datagrip',
    ['/home/kian/.local/share/JetBrains/Toolbox/apps/datagrip/bin/datagrip']
  ],
  firefox: [
    'org.mozilla.firefox',
    ['/usr/bin/firefox']
  ],
  intellij: [
    'jetbrains-idea',
    ['/home/kian/.local/share/JetBrains/Toolbox/apps/intellij-idea-ultimate/bin/idea']
  ],
  lens: [
    'Lens',
    ['/opt/Lens/lens-desktop']
  ],
  postman: [
    'Postman',
    [
      '/usr/bin/flatpak',
      'run',
      '--branch=stable',
      '--arch=x86_64',
      '--command=Postman',
      '--file-forwarding',
      'com.getpostman.Postman'
    ]
  ],
  spotify: [
    'Spotify',
    [
      '/usr/bin/flatpak',
      'run',
      '--branch=stable',
      '--arch=x86_64',
      '--command=spotify',
      '--file-forwarding',
      'com.spotify.Client'
    ]
  ],
  terminal: [
    'Konsole',
    ['konsole']
  ],
}

async function main() {
  const app = process.argv[2];
  const reverseOrder = process.argv[3] === '--reverse';
  const [windowQuery, cmdToRun, excludeQuery] = config[app] || [null, null];
  if (!windowQuery || !cmdToRun) {
    console.error(`Usage: ${process.argv[0]} ${process.argv[1]} <app-name>`);
    process.exit(1);
  }

  const windowIds = await getWindowIds(windowQuery);
  const excludedWindowIds = excludeQuery ? await getWindowIds(excludeQuery) : [];
  const filteredWindowIds = windowIds.filter(id => !excludedWindowIds.includes(id));
  if (filteredWindowIds.length === 0) {
    // No windows found with the query; start the application
    spawn(cmdToRun[0], cmdToRun.slice(1), {
      stdio: "inherit", // Inherit stdin, stdout, stderr
      detached: true,   // Detach the child process
      shell: true       // Use shell to handle commands properly
    });
    console.debug(`Spawned process`);
  } else {
    const windowId = reverseOrder
      ? getRandomWindow(filteredWindowIds, await getCurrentWindowId())
      : filteredWindowIds[0];
    // Activate the first window found
    await execPromise(`kdotool windowactivate ${windowId}`);
    console.debug(`Activated window with ID: ${windowId}`);
  }
}
main()
.then(() => process.exit(0))
.catch(err => {
  console.error(`Error: ${err}`);
  process.exit(1);
});

function getRandomWindow(windowIds, currentWindowId) {
  const filteredWindowIds = windowIds.filter(id => id !== currentWindowId);
  return filteredWindowIds[(Math.floor(Math.random() * filteredWindowIds.length))];
}

async function getWindowIds(query) {
  const output = await execPromise(`kdotool search '${query}'`);
  return output.split('\n').filter(Boolean);
}

async function getCurrentWindowId() {
  const output = await execPromise(`kdotool getactivewindow`);
  return output.trim();
}

function execPromise(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) {
        reject(`Error executing command: ${error.message}`);
      }
      if (stderr) {
        reject(`stderr: ${stderr}`);
      }
      resolve(stdout);
    });
  });
}
