import { acquireLock, releaseLock, updateLock } from '../../server/lock.js';

const dir = process.argv[2];
process.on('message', command => {
  try {
    if (command === 'acquire') acquireLock(dir);
    else {
      if (command === 'late') updateLock(dir, { browserPid: 123 });
      releaseLock(dir);
    }
    process.send(command === 'acquire' ? 'held' : 'done');
  } catch (error) {
    process.send(error.status || error.message);
  }
});
process.send('ready');
