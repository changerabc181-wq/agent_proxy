#!/usr/bin/env node
/**
 * create-admin.mjs
 *
 * 管理员账号 CLI 工具。
 *
 * 功能:
 * 1. 当系统还没有管理员时，调用 POST /setup/admin 完成首次初始化
 * 2. 当系统已有管理员时，先验证现有管理员身份，再调用 POST /admin/admins 添加新管理员
 *
 * 用法:
 *   node scripts/create-admin.mjs [选项]
 *
 * 选项:
 *   --url <url>               服务器地址 (默认: http://localhost:4000)
 *   --email <email>           新管理员邮箱
 *   --password <pass>         新管理员密码
 *   --name <name>             新管理员显示名称 (默认: Admin)
 *   --token <token>           现有管理员 Bearer Token
 *   --login-email <email>     现有管理员邮箱
 *   --login-password <pass>   现有管理员密码
 *   --help                    显示帮助
 *
 * 示例:
 *   node scripts/create-admin.mjs --email admin@example.com --password secret123
 *   node scripts/create-admin.mjs --email ops@example.com --password secret123 --login-email admin@example.com --login-password admin123
 *   node scripts/create-admin.mjs --email ops@example.com --password secret123 --token <admin-token>
 *   node scripts/create-admin.mjs   # 交互式输入
 */

import readline from "node:readline";
import https from "node:https";
import http from "node:http";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }

    args[key] = next;
    i++;
  }
  return args;
}

function printHelp() {
  console.log(`
用法:
  node scripts/create-admin.mjs [选项]

选项:
  --url <url>               服务器地址，默认 http://localhost:4000
  --email <email>           新管理员邮箱
  --password <pass>         新管理员密码
  --name <name>             新管理员显示名称，默认 Admin
  --token <token>           现有管理员 Bearer Token
  --login-email <email>     现有管理员邮箱
  --login-password <pass>   现有管理员密码
  --help                    显示帮助

说明:
  1. 如果系统还没有管理员，脚本会自动走首次初始化接口 /setup/admin
  2. 如果系统已经有管理员，脚本会要求现有管理员身份，然后调用 /admin/admins 添加新管理员

示例:
  node scripts/create-admin.mjs --url http://localhost:4000 --email admin@example.com --password secret123
  node scripts/create-admin.mjs --email ops@example.com --password secret123 --login-email admin@example.com --login-password admin123
  node scripts/create-admin.mjs --email ops@example.com --password secret123 --token <admin-token>
`);
}

function prompt(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function ensureInteractive(message) {
  if (!process.stdin.isTTY) {
    fail(message);
  }
}

function promptPassword(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
      return;
    }

    process.stdout.write(question);
    const wasRaw = stdin.isRaw;
    let input = "";

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    function onData(char) {
      if (char === "\r" || char === "\n") {
        stdin.setRawMode(wasRaw ?? false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(input);
        return;
      }

      if (char === "\u0003") {
        process.stdout.write("\n");
        process.exit(1);
      }

      if (char === "\u007f") {
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write("\b \b");
        }
        return;
      }

      input += char;
      process.stdout.write("*");
    }

    stdin.on("data", onData);
  });
}

async function requestJson(url, { method = "GET", body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const payload = body === undefined ? null : JSON.stringify(body);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname,
      method,
      headers
    };

    if (payload !== null) {
      options.headers = {
        ...headers,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      };
    }

    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          resolve({ status: res.statusCode, data });
        } catch {
          resolve({ status: res.statusCode, data: {} });
        }
      });
    });

    req.on("error", reject);
    if (payload !== null) {
      req.write(payload);
    }
    req.end();
  });
}

async function postJson(url, body, headers = {}) {
  return requestJson(url, { method: "POST", body, headers });
}

async function getJson(url) {
  return requestJson(url);
}

function validateNewAdminInput({ email, password }) {
  if (!email || !password) {
    fail("邮箱和密码不能为空。");
  }

  if (password.length < 8) {
    fail("密码长度至少需要 8 位。");
  }
}

async function collectNewAdminInput(args) {
  let email = args.email;
  let password = args.password;
  let displayName = args.name;
  const needsPrompt = !email || !password;

  if (needsPrompt) {
    ensureInteractive("缺少新管理员信息，请通过交互输入，或传入 --email 和 --password。");

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    if (!email) {
      email = await prompt(rl, "新管理员邮箱: ");
      email = email.trim();
    }

    if (!displayName) {
      displayName = await prompt(rl, "新管理员显示名称 (留空则使用 Admin): ");
      displayName = displayName.trim() || "Admin";
    }

    rl.close();
  } else {
    displayName = displayName || "Admin";
  }

  if (!password) {
    ensureInteractive("缺少新管理员密码，请通过交互输入，或传入 --password。");
    password = await promptPassword("新管理员密码: ");
    const confirm = await promptPassword("确认密码: ");
    if (password !== confirm) {
      fail("两次输入的密码不一致，请重新运行。");
    }
  }

  return { email, password, displayName };
}

async function loginAsAdmin(serverUrl, email, password) {
  const result = await postJson(`${serverUrl}/auth/login`, { email, password });
  if (result.status !== 200) {
    fail(`管理员登录失败 (HTTP ${result.status}): ${result.data?.error ?? "未知错误"}`);
  }

  if (result.data?.user?.role !== "admin") {
    fail("提供的现有账号不是管理员账号。");
  }

  return result.data.token;
}

async function resolveAdminToken(args, serverUrl) {
  if (args.token) {
    return args.token;
  }

  let loginEmail = args["login-email"];
  let loginPassword = args["login-password"];

  if (!loginEmail || !loginPassword) {
    ensureInteractive("系统已存在管理员，请提供 --token 或现有管理员登录凭证。");

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (!loginEmail) {
      loginEmail = await prompt(rl, "现有管理员邮箱: ");
      loginEmail = loginEmail.trim();
    }
    rl.close();

    if (!loginPassword) {
      loginPassword = await promptPassword("现有管理员密码: ");
    }
  }

  return loginAsAdmin(serverUrl, loginEmail, loginPassword);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const serverUrl = args.url ?? process.env.SERVER_URL ?? "http://localhost:4000";

  console.log("=== Agent Proxy - 管理员账号工具 ===\n");

  let statusResult;
  try {
    statusResult = await getJson(`${serverUrl}/setup/status`);
  } catch (err) {
    fail([
      `无法连接到服务器 ${serverUrl}`,
      "请确认服务器已启动，或使用 --url 指定正确的地址。",
      `错误: ${err.message}`
    ].join("\n"));
  }

  if (statusResult.status !== 200) {
    fail(`获取初始化状态失败 (HTTP ${statusResult.status}): ${statusResult.data?.error ?? "未知错误"}`);
  }

  const nextAdmin = await collectNewAdminInput(args);
  validateNewAdminInput(nextAdmin);

  if (statusResult.data.needsSetup) {
    console.log(`\n正在创建初始管理员账号 (${nextAdmin.email})...`);

    let result;
    try {
      result = await postJson(`${serverUrl}/setup/admin`, nextAdmin);
    } catch (err) {
      fail(`请求失败: ${err.message}`);
    }

    if (result.status === 201) {
      console.log("\n初始管理员账号创建成功！");
      console.log(`  邮箱: ${result.data.user.email}`);
      console.log(`  名称: ${result.data.user.displayName}`);
      console.log(`  角色: ${result.data.user.role}`);
      console.log(`\n请访问 ${serverUrl} 登录管理后台。`);
      return;
    }

    fail(`创建失败 (HTTP ${result.status}): ${result.data?.error ?? "未知错误"}`);
  }

  console.log("检测到系统已存在管理员，将验证现有管理员身份。");

  let token;
  try {
    token = await resolveAdminToken(args, serverUrl);
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }

  console.log(`\n正在添加管理员账号 (${nextAdmin.email})...`);

  let result;
  try {
    result = await postJson(`${serverUrl}/admin/admins`, nextAdmin, {
      Authorization: `Bearer ${token}`
    });
  } catch (err) {
    fail(`请求失败: ${err.message}`);
  }

  if (result.status === 201) {
    console.log("\n管理员账号添加成功！");
    console.log(`  邮箱: ${result.data.user.email}`);
    console.log(`  名称: ${result.data.user.displayName}`);
    console.log(`  角色: ${result.data.user.role}`);
    console.log(`\n请访问 ${serverUrl} 登录管理后台。`);
    return;
  }

  fail(`添加失败 (HTTP ${result.status}): ${result.data?.error ?? "未知错误"}`);
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
