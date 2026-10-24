'use strict';
const path = require('path');
const fsp = require('fs').promises;
const { spawn } = require('child_process');
const { rulesAllow } = require('./util');
const { installVersion } = require('./install');
const { ensureJava } = require('./java');
const { resolveVersion } = require('./versions');
const { networkArgs, launchNetwork } = require('./network');

// BootstrapLauncher ignores the launcher client JAR by filename, not version id.
function bootstrapArgs(args, version, jarPath) {
  if (version.mainClass !== 'cpw.mods.bootstraplauncher.BootstrapLauncher') return args;
  const prefix = '-DignoreList=';
  const names = new Set(args.filter(a => a.startsWith(prefix)).flatMap(a => a.slice(prefix.length).split(',').filter(Boolean)));
  names.add(path.basename(jarPath));
  const out = args.filter(a => !a.startsWith(prefix));
  out.push(prefix + [...names].join(','));
  return out;
}

function fill(str, vars) {
  return str.replace(/\$\{([^}]+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

function expandArgs(list, vars, features) {
  const out = [];
  for (const a of list || []) {
    if (typeof a === 'string') out.push(fill(a, vars));
    else if (rulesAllow(a.rules, features)) {
      const v = Array.isArray(a.value) ? a.value : [a.value];
      for (const s of v) out.push(fill(s, vars));
    }
  }
  return out;
}

/**
 * Запуск игры.
 * opts: { root, versionId, gameDir, account:{name,uuid,accessToken,type}, memory, jvmArgs, width, height, javaPath, onProgress, onLog, onExit }
 */
async function launch(opts) {
  const { root, versionId, gameDir, account, onProgress = () => {}, onLog = () => {}, onExit = () => {} } = opts;
  await fsp.mkdir(gameDir, { recursive: true });
  const metadata = await resolveVersion(root, versionId);
  const java = await ensureJava(root, metadata, { customPath: opts.javaPath, onProgress });
  onLog(`[Fox] Java ${java.version} (нужна ${java.need}): ${java.path}\n`);
  const inst = await installVersion(root, versionId, onProgress);
  const { version, libs, jarPath, nativesDir, logConfig } = inst;

  const sep = path.delimiter;
  const cpSet = new Set();
  const cp = [];
  for (const l of libs) if (l.classpath) {
    const p = path.join(root, 'libraries', l.path);
    if (!cpSet.has(p)) { cpSet.add(p); cp.push(p); }
  }
  cp.push(jarPath);

  const assetsRoot = path.join(root, 'assets');
  const aiId = version.assetIndex ? version.assetIndex.id : 'legacy';
  let gameAssets = assetsRoot;
  if (inst.assetIndex && (inst.assetIndex.virtual || inst.assetIndex.map_to_resources)) gameAssets = path.join(assetsRoot, 'virtual', aiId);
  if (inst.assetIndex && inst.assetIndex.map_to_resources) {
    // очень старые версии читают ресурсы из gameDir/resources
    const res = path.join(gameDir, 'resources');
    await fsp.cp(gameAssets, res, { recursive: true, force: false, errorOnExist: false }).catch(() => {});
  }

  const isMs = account.type === 'microsoft';
  const vars = {
    auth_player_name: account.name,
    version_name: version.id,
    game_directory: gameDir,
    assets_root: gameAssets,
    game_assets: gameAssets,
    assets_index_name: aiId,
    auth_uuid: account.uuid,
    auth_access_token: account.accessToken || '0',
    auth_session: isMs ? `token:${account.accessToken}:${account.uuid}` : '0',
    auth_xuid: account.xuid || '0',
    clientid: '0',
    user_type: isMs ? 'msa' : 'legacy',
    user_properties: '{}',
    version_type: 'Fox Launcher',
    natives_directory: nativesDir,
    launcher_name: 'FoxLauncher',
    launcher_version: '1.0.0',
    classpath: cp.join(sep),
    classpath_separator: sep,
    library_directory: path.join(root, 'libraries'),
    resolution_width: String(opts.width || 925),
    resolution_height: String(opts.height || 530),
  };
  const features = { has_custom_resolution: !!(opts.width && opts.height), is_demo_user: false };

  const jvm = [`-Xmx${opts.memory || 2048}M`, `-Xms${Math.min(512, opts.memory || 2048)}M`];
  if (opts.jvmArgs) jvm.push(...opts.jvmArgs.split(/\s+/).filter(Boolean));
  if (version.arguments && version.arguments.jvm) jvm.push(...expandArgs(version.arguments.jvm, vars, features));
  else jvm.push(`-Djava.library.path=${nativesDir}`, '-cp', vars.classpath);
  if (logConfig && logConfig.argument) jvm.push(fill(logConfig.argument, { path: logConfig.path }));
  // Дополнительная защита для старых версий Log4j (плюс официальный logging config).
  jvm.push('-Dlog4j2.formatMsgNoLookups=true');

  let game;
  if (version.arguments && version.arguments.game) game = expandArgs(version.arguments.game, vars, features);
  else game = fill(version.minecraftArguments || '', vars).split(' ').filter(Boolean);
  if (!version.arguments && features.has_custom_resolution) game.push('--width', vars.resolution_width, '--height', vars.resolution_height);

  const adapters = launchNetwork(onLog, account.type);
  const args = [...networkArgs(bootstrapArgs(jvm, version, jarPath), adapters), version.mainClass, ...game];
  onLog(`[Fox] Запуск ${version.id} как ${account.name}\n`);
  onProgress({ stage: 'launch', text: 'Запуск игры…', done: 1, total: 1 });

  const child = spawn(java.path, args, { cwd: gameDir, windowsHide: false, detached: false });
  child.stdout.on('data', d => onLog(d.toString()));
  child.stderr.on('data', d => onLog(d.toString()));
  await new Promise((resolve,reject)=>{ child.once('spawn',resolve); child.once('error',reject); });
  child.on('exit', code => onExit(code));
  child.on('error', e => { onLog('[Fox] Ошибка запуска: ' + e.message + '\n'); });
  return { pid: child.pid, java, kill: () => child.kill() };
}

module.exports = { launch, bootstrapArgs };
