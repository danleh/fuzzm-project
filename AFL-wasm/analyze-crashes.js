#!/usr/bin/env node
const fs = require('fs');
const cp = require('child_process');
const p = require('path');

const benchmark = process.argv[2];
const printTraces = process.argv[3];

let preFileArg = ""; 
let args = [];
let nativeBinary;
let relativePath = false;

switch (benchmark) {
  case "pal2rgb":
    args = ["/dev/null"];
    folder = "programs/pal2rgb-wasm";
    nativeBinary = "programs/pal2rgb/prog";
    break;
  case "opj_compress":
    preFileArg = "-i";
    args = ["-o", "programs/opj_compress-wasm/out.jp2"];
    folder = "programs/opj_compress-wasm";
    nativeBinary = "programs/opj_compress/prog";
    break;
  case "pdfresurrect":
    args = [""];
    folder = "programs/pdfresurrect-wasm";
    nativeBinary = "programs/pdfresurrect/prog";
    break;
  case "pnm2png":
    args = ["/dev/null"];
    folder = "programs/pnm2png-wasm";
    nativeBinary = "programs/pnm2png/prog";
    break;
  case "palbart":
    args = [""];
    folder = "programs/palbart-wasm";
    nativeBinary = "programs/palbart/prog";
    // Otherwise it complains about too long path names.
    relativePath = true;
    break;
  case "base64":
    preFileArg = "--decode";
    folder = "programs/base64-wasm";
    nativeBinary = "programs/base64/prog";
    break;
  case "md5sum":
    preFileArg = "-c";
    folder = "programs/md5sum-wasm";
    nativeBinary = "programs/md5sum/prog";
    break;
  case "uniq":
    folder = "programs/uniq-wasm";
    nativeBinary = "programs/uniq/prog";
    break;
  case "abc2mtex":
    folder = "programs/abc2mtex-wasm";
    nativeBinary = "programs/abc2mtex/prog";
    break;
  case "jbig2dec":
    folder = "programs/jbig2dec-wasm";
    nativeBinary = "programs/abc2mtex/prog";
    args=["-t", "png", "-o", "/dev/null"];
    break;
  case "flac":
    folder = "programs/flac-wasm";
    nativeBinary = "programs/flac/prog";
    args=["-f", "-d"];
    break;
}

if (!folder) {
  console.log(`usage: ./analyze-crashes.js [pal2rgb/opj_compress/pdfresurrect/pnm2png/palbart] printTraces?`);
  process.exit(1);
}

const wasmBinary = p.resolve(folder, 'prog.wasm');
const instrWasmBinary = p.resolve(folder, 'prog.wasm.instr');
// guess the location of the native binary
const crashFolder = p.resolve(folder, 'findings', 'crashes');

const results = {};

async function run(execStr) {
  return new Promise(res => {
    cp.exec(execStr, {stdio: 'ignore', timeout: 5000}, (err, stdout, stderr) => {
      const timedout = err && err.signal === 'SIGTERM';
      res([stderr, stdout, err ? err.code : 0, timedout]);
    });
  });
}

async function runWasmBin(bin, crashFile) {
  const execStr = `wasmtime ${bin} --dir=. --dir=/ -- ${preFileArg || ''} ${crashFile} ${args.join(' ')}`;
  return run(execStr);
}

async function runNativeBin(bin, crashFile) {
  const execStr = `${bin} ${preFileArg || ''} ${crashFile} ${args.join(' ')}`;
  return run(execStr);
}

/*
 * {reason, stderr}
 */ 
function getReason(stderr, stdout, code, timedout) {
  if (timedout)
    return {reason: 'timedout', stderr};

  const reasonRegexp = /wasm trap: (.+)/;
  const m = reasonRegexp.exec(stderr);
  let reason = m ? m[1] : 'no trap';

  const lava_regexp = /Successfully triggered bug (\d+), crashing now!/
  const l = lava_regexp.exec(stdout);
  reason = l ? `LAVA BUG ${l[1]}` : reason;

  return {reason, stderr};
}

(async function () {
  const crashFiles = fs.readdirSync(crashFolder).filter(f => !f.includes("README"));
  const count = crashFiles.length;
  let diffCount = 0;

  // where 'unreachable' with canaries but not without
  let canaryInducedCrashes = 0;
  while (crashFiles.length) {
    await Promise.all(crashFiles.splice(0, 2).map(async crashFile => {
      const res = {};

      let crashFilePath = p.join(crashFolder, crashFile);
      if (relativePath) {
        crashFilePath = p.relative(__dirname, crashFilePath);
      }

      res.wasm = getReason(...(await runWasmBin(wasmBinary, crashFilePath)));
      res.wasmInstr = getReason(...(await runWasmBin(instrWasmBinary, crashFilePath)));
      res.native = (await runNativeBin(nativeBinary, crashFilePath))[2];
      results[crashFile] = res; 

      const diff = res.wasm.reason !== res.wasmInstr.reason;
      if (diff) diffCount++;

      if (diff && res.wasmInstr.stderr.includes("unreachable")) canaryInducedCrashes++;

      const key = diff ? `\x1b[36m${crashFile}\x1b[0m` : crashFile;
      console.log(key);
      console.log(` - wasm: ${res.wasm.reason}`);
      if (printTraces && diff) console.log(res.wasm.stderr);
      console.log(` - wasmInstr: ${res.wasmInstr.reason}`);
      if (printTraces && diff) console.log(res.wasmInstr.stderr);
      console.log(` - native: ${res.native}`);
    }));
  }

  //console.log(JSON.stringify(results, null, 2));
  console.log(`total crashes ${count}\ndiff crashes ${diffCount}\ncanary induced crashes ${canaryInducedCrashes}`);
})();





