#!/usr/bin/env node
/**
 * create-admin.mjs
 *
 * 首次运行时用于创建管理员账号的 CLI 工具。
 * 调用服务器的 POST /setup/admin 接口（仅在没有管理员时可用）。
 *
 * 用法:
 *   node scripts/create-admin.mjs [选项]
 *
 * 选项:
 *   --url <url>        服务器地址 (默认: http://localhost:4000)
 *   --email <email>    管理员邮箱
 *   --password <pass>  管理员密码
 *   --name <name>      显示名称 (默认: Admin)
 *
 * 示例:
 *   node scripts/create-admin.mjs --email admin@example.com --password secret123
 *   node scripts/create-admin.mjs   # 交互式输入
 */

import readline from "node:readline";
import https from "node:https";
import http from "node:http";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--") && i + 1 < argv.length) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1];
      i++;
    }
  }
  return args;
}

function prompt(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function promptPassword(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
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
      } else if (char === "\u0003") {
        process.stdout.write("\n");
        process.exit(1);
      } else if (char === "\u007f") {
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else {
        input += char;
        process.stdout.write("*");
      }
    }

    stdin.on("data", onData);
  });
}

async function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      }
    };

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
    req.write(payload);
    req.end();
  });
}

async function getJson(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    lib.get(url, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
        } catch {
          resolve({ status: res.statusCode, data: {} });
        }
      });
    }).on("error", reject);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const serverUrl = args.url ?? process.env.SERVER_URL ?? "http://localhost:4000";

  console.log("=== Agent Proxy - 管理员账号创建工具 ===\n");

  // 检查服务器是否在线以及是否已有管理员
  let statusResult;
  try {
    statusResult = await getJson(`${serverUrl}/setup/status`);
  } catch (err) {
    console.error(`无法连接到服务器 ${serverUrl}`);
    console.error("请确认服务器已启动，或使用 --url 指定正确的地址。");
    console.error(`错误: ${err.message}`);
    process.exit(1);
  }

  if (!statusResult.data.needsSetup) {
    console.error("管理员账号已存在，无需重复创建。");
    console.error("请访问登录页面使用已有的管理员账号登录。");
    process.exit(1);
  }

  let email = args.email;
  let password = args.password;
  let displayName = args.name;

  const isInteractive = !email || !password;

  if (isInteractive) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    if (!email) {
      email = await prompt(rl, "管理员邮箱: ");
      email = email.trim();
    }

    if (!displayName) {
      displayName = await prompt(rl, "显示名称 (留空则使用 Admin): ");
      displayName = displayName.trim() || "Admin";
    }

    rl.close();

    if (!password) {
      password = await promptPassword("管理员密码: ");
      const confirm = await promptPassword("确认密码: ");
      if (password !== confirm) {
        console.error("两次输入的密码不一致，请重新运行。");
        process.exit(1);
      }
    }
  } else {
    displayName = displayName || "Admin";
  }

  if (!email || !password) {
    console.error("邮箱和密码不能为空。");
    process.exit(1);
  }

  if (password.length < 8) {
    console.error("密码长度至少需要 8 位。");
    process.exit(1);
  }

  console.log(`\n正在创建管理员账号 (${email})...`);

  let result;
  try {
    result = await postJson(`${serverUrl}/setup/admin`, { email, password, displayName });
  } catch (err) {
    console.error(`请求失败: ${err.message}`);
    process.exit(1);
  }

  if (result.status === 201) {
    console.log("\n管理员账号创建成功！");
    console.log(`  邮箱: ${result.data.user.email}`);
    console.log(`  名称: ${result.data.user.displayName}`);
    console.log(`  角色: ${result.data.user.role}`);
    console.log(`\n请访问 ${serverUrl} 登录管理后台。`);
  } else if (result.status === 409) {
    console.error("管理员账号已存在。");
    process.exit(1);
  } else {
    console.error(`创建失败 (HTTP ${result.status}): ${result.data?.error ?? "未知错误"}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
