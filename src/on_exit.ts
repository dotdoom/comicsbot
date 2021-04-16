const signals: NodeJS.Signals[] = ['SIGINT', 'SIGHUP', 'SIGTERM', 'SIGQUIT'];

export function onExit(callback: () => Promise<void> | void) {
  let callbackInvoked = false;
  const callbackOnce = async () => {
    if (!callbackInvoked) {
      callbackInvoked = true;
      await callback();
    }
  };

  process.on('beforeExit', callbackOnce);
  for (const signal of signals) {
    process.on(signal, async signal => {
      process.exitCode = 0;
      try {
        await callbackOnce();
      } finally {
        // eslint-disable-next-line no-process-exit
        process.exit();
      }
    });
  }
  process.on('uncaughtException', () => {
    // https://nodejs.org/api/process.html#process_event_uncaughtexception
    process.exitCode = 1;
    callbackOnce();
  });
}
