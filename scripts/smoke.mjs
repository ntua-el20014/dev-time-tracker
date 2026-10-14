// Smoke test: launch the packaged app in an isolated profile, attach over the
// Chrome DevTools Protocol, reload with error capture, and check the UI.
//
// Usage (repo root, after `npm run package`):  npm run test:smoke
//   INTERACT=1  also click through record/pause/stop, incognito, login form
//   DEV=<repo>  test `electron-forge start` instead of the packaged build
//   SHOT=<png>  save a screenshot   WAIT=<ms>  time to wait after reload
// Uses an isolated profile (DTT_USER_DATA_DIR) and disables Sentry, so the
// real installation and its data are never touched. Windows only (taskkill).
import { spawn, execSync } from "child_process";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";

const exe = process.argv[2] || path.join(process.cwd(), "out", "dev-time-tracker-win32-x64", "dev-time-tracker.exe");
const work = process.argv[3] || path.join(os.tmpdir(), "dtt-smoke");
const PORT = 9333;
rmSync(work, { recursive: true, force: true });
mkdirSync(path.join(work, "profile"), { recursive: true });
mkdirSync(path.join(work, "home"), { recursive: true });

const isDev = !!process.env.DEV;
const child = spawn(
  isDev ? "npx.cmd electron-forge start -- --remote-debugging-port=" + PORT : exe,
  isDev ? [] : [`--remote-debugging-port=${PORT}`],
  {
  shell: isDev,
  cwd: isDev ? process.env.DEV : undefined,
  env: {
    ...process.env,
    DTT_USER_DATA_DIR: path.join(work, "profile"),
    USERPROFILE: path.join(work, "home"),
    SENTRY_DSN: "",
  },
  stdio: "ignore",
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const killTree = () => {
  try {
    execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: "ignore" });
  } catch {}
};

const results = { exceptions: [], consoleErrors: [], checks: {} };
try {
  let target;
  for (let i = 0; i < (isDev ? 360 : 40) && !target; i++) {
    await sleep(500);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      target = list.find((t) => t.type === "page" && !t.url.startsWith("devtools://"));
    } catch {}
  }
  if (!target) throw new Error("no page target (app did not open a window)");
  results.url = target.url;

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    } else if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      results.exceptions.push(
        (d.exception?.description || d.text || "").split("\n").slice(0, 3).join(" | "),
      );
    } else if (msg.method === "Runtime.consoleAPICalled") {
      (msg.params.type === "error" ? results.consoleErrors : (results.consoleLog ??= [])).push(
        msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300),
      );
    } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
      results.consoleErrors.push(`[${msg.params.entry.source}] ${msg.params.entry.text}`.slice(0, 300));
    }
  };
  const send = (method, params = {}) =>
    new Promise((r) => {
      const mid = ++id;
      pending.set(mid, r);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  const evaluate = async (expression) =>
    (await send("Runtime.evaluate", { expression, returnByValue: true })).result?.result?.value;

  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");
  await send("Page.reload", { ignoreCache: true });
  await sleep(Number(process.env.WAIT || 8000));

  results.checks = await evaluate(`(() => ({
    title: document.title,
    nodeIntegration: typeof require !== "undefined",
    hasElectronAPI: typeof window.electronAPI !== "undefined",
    landingVisible: !!document.getElementById("userLanding") &&
      getComputedStyle(document.getElementById("userLanding")).display !== "none",
    landingHtmlLength: (document.getElementById("userLanding")?.innerHTML || "").length,
    hasLoginForm: !!document.querySelector("#userLanding form, #userLanding input[type=password]"),
    recordBtnPresent: !!document.getElementById("recordBtn"),
    mainUIDisplay: document.getElementById("mainUI")?.style.display,
    readyState: document.readyState,
    bodyClasses: document.body.className,
  }))()`);
  results.trackingState = await evaluate(
    `(async () => { try {
        const api = window.electronAPI;
        if (api) return await api.invoke("get-tracking-state");
        return await require("electron").ipcRenderer.invoke("get-tracking-state");
      } catch (e) { return "ERR " + e.message } })()`,
  );
  // Runtime.evaluate doesn't await promises without awaitPromise; redo properly
  results.trackingState = (
    await send("Runtime.evaluate", {
      expression: `(async () => { try {
        const api = window.electronAPI;
        if (api) return await api.invoke("get-tracking-state");
        return await require("electron").ipcRenderer.invoke("get-tracking-state");
      } catch (e) { return "ERR " + e.message } })()`,
      awaitPromise: true,
      returnByValue: true,
    })
  ).result?.result?.value;
  if (process.env.INTERACT) {
    const ev = async (expression) =>
      (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }))
        .result?.result?.value;
    const steps = {};
    // 1. Main -> renderer broadcast path: start tracking via IPC, renderer
    //    must re-render the record button from the "tracking-state" event.
    steps.start = await ev(`window.electronAPI.invoke("start-tracking")`);
    await sleep(500);
    steps.recordBtnTitleWhileRecording = await ev(`document.getElementById("recordBtn").title`);
    steps.pauseBtnShown = await ev(`document.getElementById("pauseBtn").style.display !== "none"`);
    steps.pause = await ev(`window.electronAPI.invoke("pause-tracking")`);
    await sleep(300);
    steps.pauseBtnTitleWhilePaused = await ev(`document.getElementById("pauseBtn").title`);
    steps.stop = await ev(`window.electronAPI.invoke("stop-tracking")`);
    await sleep(300);
    steps.recordBtnTitleAfterStop = await ev(`document.getElementById("recordBtn").title`);
    // 2. Incognito: renderer listener toggles the banner
    steps.incognito = await ev(`window.electronAPI.invoke("toggle-incognito")`);
    await sleep(300);
    steps.bannerShown = await ev(`getComputedStyle(document.getElementById("incognitoBanner")).display !== "none"`);
    await ev(`window.electronAPI.invoke("toggle-incognito")`);
    // 3. UI-only: open the login form
    steps.clickLogin = await ev(`(() => { const el = [...document.querySelectorAll("#userLanding *")].find(e => e.children.length === 0 && e.textContent.trim() === "Login"); if (!el) return "no Login element"; el.click(); return "clicked"; })()`);
    await sleep(800);
    steps.passwordFieldShown = await ev(`!!document.querySelector("input[type=password]")`);
    steps.unapprovedExportRejected = await ev(`window.electronAPI.invoke("export-custom-json", {a:[1]}, "C:\\Windows\\Temp\\dtt-smoke.json").then(r => r.status)`);
    steps.nonHttpOpenRejected = await ev(`window.electronAPI.invoke("open-oauth-url", "file:///C:/Windows/System32/calc.exe").then(() => "opened", e => "rejected")`);
    results.interact = steps;
  }
  results.updater = (
    await send("Runtime.evaluate", {
      expression: `window.electronAPI.invoke("updater:get-state")`,
      awaitPromise: true,
      returnByValue: true,
    })
  ).result?.result?.value;
  results.landingText = await evaluate(
    `(document.getElementById("userLanding")?.innerText || "").replace(/\s+/g, " ").slice(0, 200)`,
  );
  if (process.env.SHOT) {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(process.env.SHOT, Buffer.from(shot.result.data, "base64"));
    results.screenshot = process.env.SHOT;
  }
  ws.close();
} catch (err) {
  results.fatal = String(err);
} finally {
  killTree();
}
console.log(JSON.stringify(results, null, 2));
