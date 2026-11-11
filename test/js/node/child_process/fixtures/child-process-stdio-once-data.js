// Prints what a consumer that takes one event at a time gets from a child's stdio stream, as JSON. Node prints the same line.
//
// usage: <runtime> child-process-stdio-once-data.js <stdout|stderr> <form> <empty scratch dir> [execFile]
//
// form: a loop of `await once(stream, "data")`, and what it does between two `once()` calls
//   job       nothing: the stream has no 'data' listener for the length of one promise job
//   tick      it awaits a promise that a nextTick settles
//   pause     pause(), the same await, resume()
// or
//   readable  a 'readable' listener that takes all that is buffered with read(n), so read() never returns null
// execFile: the child is one of execFile(), whose own 'data' listener stays on the stream.
//
// The child writes a head of 4 bytes when the parent's first read waits, and a tail of 96 KiB that it closes the pipe
// behind while the listeners of the head run. So the tail and the EOF are in the pipe when the loop continues, and the
// tail does not fit one read of 64 KiB.
const { execFile, spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");

const [which, form, dir, spawner] = process.argv.slice(2);
const fd = which === "stdout" ? 1 : 2;
const HEAD = 4;
const TAIL = 96 * 1024;
const file = name => path.join(dir, name);

const sleeper = new Int32Array(new SharedArrayBuffer(4));
// Blocks the event loop, so that nothing is read or delivered until `name` exists.
function waitFor(name) {
  const deadline = Date.now() + 15_000;
  while (!fs.existsSync(path.join(dir, name))) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${name}`);
    Atomics.wait(sleeper, 0, 0, 1);
  }
}

// A shell script, so that the child starts in a few milliseconds. `$0` is the scratch directory.
const to = fd === 1 ? "" : " >&2";
const producer = `
  cd "$0"
  until [ -e head ]; do sleep 0.01; done
  printf hhhh${to}
  : > head-done
  until [ -e tail ]; do sleep 0.01; done
  head -c ${TAIL} /dev/zero | tr '\\000' t${to}
  exec ${fd}>&-
  : > tail-done
`;

const stdio = ["ignore", "ignore", "ignore"];
stdio[fd] = "pipe";
const child =
  spawner === "execFile"
    ? execFile("sh", ["-c", producer, dir], { encoding: "buffer" }, () => {})
    : spawn("sh", ["-c", producer, dir], { stdio });
const stream = child.stdio[fd];

function writeHead() {
  fs.writeFileSync(file("head"), "");
  waitFor("head-done");
}
function writeTail() {
  fs.writeFileSync(file("tail"), "");
  waitFor("tail-done");
}

const chunks = [];
let sawEnd = false;
if (form === "readable") {
  // The stream's first read was issued in a nextTick: it has found the pipe empty and waits.
  setImmediate(writeHead);
  stream.on("readable", () => {
    if (chunks.length === 0) writeTail();
    if (stream.readableLength > 0) chunks.push(stream.read(stream.readableLength));
  });
  stream.on("end", () => {
    sawEnd = true;
  });
} else {
  // 'resume' comes when the first read has found the pipe empty and waits.
  stream.once("resume", writeHead);
  // Runs with the first chunk, before the loop below continues.
  stream.once("data", writeTail);
  const ended = once(stream, "end").then(() => {
    sawEnd = true;
    return null;
  });
  (async () => {
    for (;;) {
      const next = await Promise.race([once(stream, "data"), ended]);
      if (next === null) break;
      chunks.push(next[0]);
      if (form === "pause") stream.pause();
      if (form !== "job") await new Promise(resolve => process.nextTick(resolve));
      if (form === "pause") stream.resume();
    }
  })();
}

child.on("close", exitCode => {
  const out = Buffer.concat(chunks);
  console.log(
    JSON.stringify({
      exitCode,
      sawEnd,
      length: out.length,
      head: out.subarray(0, HEAD).equals(Buffer.alloc(HEAD, "h")),
      tail: out.subarray(HEAD).equals(Buffer.alloc(TAIL, "t")),
    }),
  );
});
