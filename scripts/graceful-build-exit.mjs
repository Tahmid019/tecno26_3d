// Vinext's CLI forces process.exit(0) immediately after building. On Windows,
// this races the native bundler's async-handle cleanup and aborts libuv.
// Successful builds drain normally; all failure exit codes remain unchanged.
if (process.platform === 'win32') {
  const immediateExit = process.exit.bind(process);
  process.exit = (code) => {
    if (code === 0) { process.exitCode = 0; return; }
    return immediateExit(code);
  };
}
