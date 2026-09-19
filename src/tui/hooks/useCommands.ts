import { useCallback } from 'react';
import type { App } from '../../app/index.js';
import { SessionManager } from '../../session/index.js';

interface CommandResult {
  handled: boolean;
  output?: string;
  /**
   * v3.0.5: 'reload_model' / 'apply_ttl' / 'resume' are handled async by
   * app.tsx after the sync output is displayed (reloadModel / applyTtl /
   * session load are async or need React state access).
   */
  action?: 'clear' | 'reinit' | 'reload_model' | 'apply_ttl' | 'resume' | 'model_settings';
  payload?: any;
}

// 中文命令别名映射
const CMD_ALIASES: Record<string, string> = {
  '/模型': '/model',
  '/新建': '/new',
  '/清空': '/new',
  '/压缩': '/compact',
  '/技能': '/skills',
  '/技能管理': '/skills',
  '/mcp': '/mcp',
  '/帮助': '/help',
  '/服务商': '/provider',
  '/思考': '/thinking',
  '/缓存': '/cache',
  '/ttl': '/ttl',
  '/TTL': '/ttl',
  '/恢复': '/resume',
  '/继续': '/resume',
  '/yolo': '/yolo',
  '/YOLO': '/yolo',
  '/模型设置': '/models',
  '/模型管理': '/models',
};

export const COMMAND_LIST = [
  { name: '/模型', desc: '切换模型' },
  { name: '/models', desc: '模型设置（添加/上下文/思考）' },
  { name: '/服务商', desc: '更换服务商' },
  { name: '/新建', desc: '新建会话' },
  { name: '/resume', desc: '恢复历史会话' },
  { name: '/压缩', desc: '压缩上下文' },
  { name: '/缓存', desc: '缓存命中率' },
  { name: '/ttl', desc: '查看/设置 Cache TTL' },
  { name: '/技能', desc: '管理技能' },
  { name: '/mcp', desc: 'MCP 服务器状态' },
  { name: '/yolo', desc: '切换自动确认' },
  { name: '/帮助', desc: '查看帮助' },
];

export function useCommands(app: App) {

  const handleCommand = useCallback((input: string): CommandResult => {
    const cmd = input.trim();
    const parts = cmd.split(/\s+/);
    let name = parts[0].toLowerCase();
    const arg = parts.slice(1).join(' ');

    // 中文别名映射
    if (CMD_ALIASES[name]) {
      name = CMD_ALIASES[name];
    }

    // ── /model [name] ───────────────────────────────────
    if (name === '/model') {
      if (!arg) {
        const c = app.config.get();
        return {
          handled: true,
          output: [
            `当前: ${c.provider} / ${c.model}`,
            '',
            '用法: /模型 <名称>',
            '  /模型 deepseek-chat',
            '  /模型 gpt-4o',
            '  /模型 claude-sonnet-4-20250514',
            '',
            '或: /服务商 更换服务商',
          ].join('\n'),
        };
      }
      app.config.save({ model: arg });
      // v3.0.5: app.tsx performs `await app.reloadModel()` so the switch is
      // immediate. It used to require a restart to take effect.
      return { handled: true, output: `模型 → ${arg}（切换中…）`, action: 'reload_model' };
    }

    // ── /provider ───────────────────────────────────────
    if (name === '/provider') {
      return { handled: true, action: 'reinit' };
    }

    // ── /new, /clear ────────────────────────────────────
    if (name === '/new') {
      // v3.0.5: reset() keeps the system prompt — clear() used to wipe it,
      // leaving the model unprompted until restart.
      app.session.reset();
      return { handled: true, output: '新会话已创建（系统提示已保留）。', action: 'clear' };
    }

    // ── /compact ────────────────────────────────────────
    if (name === '/compact') {
      // v3.0.5: real compaction with atomic tool-call groups. The old path
      // re-summarized on every call and could cut a tool_calls/result pair.
      const r = app.session.compactNow();
      if (!r) {
        return { handled: true, output: '上下文无需压缩（未超过阈值或没有可压缩内容）。' };
      }
      return { handled: true, output: `上下文已压缩: ${r.before} → ${r.after} 条消息（工具调用块保持完整）` };
    }

    // ── /resume [序号] ──────────────────────────────────
    if (name === '/resume') {
      if (!arg) {
        const list = SessionManager.list(10);
        if (list.length === 0) {
          return { handled: true, output: '暂无历史会话。会话在每轮对话后自动保存到 ~/.thatgfsj/sessions/。' };
        }
        const lines = [
          '最近的会话:',
          '',
          ...list.map((s, i) => {
            const time = s.updatedAt.toISOString().replace('T', ' ').slice(0, 16);
            return `  ${i + 1}.  ${time}  ${s.messageCount} 条  ${s.preview}`;
          }),
          '',
          '用法: /resume <序号>   例: /resume 1',
        ];
        return { handled: true, output: lines.join('\n') };
      }
      const idx = parseInt(arg, 10);
      if (!Number.isFinite(idx) || idx < 1 || idx > 10) {
        return { handled: true, output: '用法: /resume <序号>（1-10，先运行 /resume 查看列表）' };
      }
      // Async load handled by app.tsx (needs React hydration).
      return { handled: true, output: '', action: 'resume', payload: idx - 1 };
    }

    // ── /models — 模型设置对话框 ─────────────────────────
    if (name === '/models') {
      return { handled: true, action: 'model_settings' };
    }

    // ── /yolo ───────────────────────────────────────────
    if (name === '/yolo') {
      const turningOn = app.permissionMode !== 'accept';
      // v3.0.5: setYolo also refreshes the system prompt's permission section.
      app.setYolo(turningOn);
      return {
        handled: true,
        output: turningOn
          ? '✓ YOLO 已开启：写/执行类工具调用不再询问（慎用）'
          : '✓ YOLO 已关闭：写/执行类工具调用恢复确认',
      };
    }

    // ── /cache — prompt cache hit-rate + cost savings ───
    if (name === '/cache') {
      if (arg === 'reset' || arg === '重置') {
        app.cacheStats.reset();
        return { handled: true, output: '✓ 缓存统计已重置' };
      }
      if (arg === 'off' || arg === '关') {
        return {
          handled: true,
          output: [
            '✗ 关闭缓存功能：在 ~/.thatgfsj/config.json 添加 "cache": { "enabled": false } 后重启。',
            '  （提示：完全关闭会大幅增加 token 成本；推荐保留开启）',
          ].join('\n'),
        };
      }
      const s = app.cacheStats.snapshot();
      if (s.totalRequests === 0) {
        return {
          handled: true,
          output: [
            '⚡ 缓存统计',
            '─────────────────────────',
            '  暂无请求。开启一段对话后再来查看。',
            '',
            '/cache reset  ·  重置统计',
          ].join('\n'),
        };
      }
      const hitRateStr = (s.hitRate * 100).toFixed(1) + '%';
      const recent = s.history.slice(-10);
      const lines = [
        '⚡ 缓存统计 (累计 ' + s.totalRequests + ' 轮)',
        '─────────────────────────',
        `  命中率:      ${hitRateStr}  (${s.totalReadTokens.toLocaleString()} / ${s.totalInputTokens.toLocaleString()} tokens)`,
        `  累计创建:    ${s.totalCreationTokens.toLocaleString()} tokens`,
        `  累计节省:    ¥${s.estimatedSavingsCNY.toFixed(4)}`,
        '',
        '最近 10 轮:',
      ];
      for (let i = 0; i < recent.length; i++) {
        const r = recent[i];
        const tag = r.read > 0 ? '⚡' : '💸';
        const pct = (r.hitRate * 100).toFixed(0) + '%';
        lines.push(`  #${s.history.length - recent.length + i + 1}  [${tag}] ${String(r.read).padStart(5)} / ${String(r.input).padStart(5)}  ${pct.padStart(4)}`);
      }
      lines.push('');
      lines.push('/cache reset  ·  重置统计');
      return { handled: true, output: lines.join('\n') };
    }

    // v3.0.3: /ttl — view or pin the cache TTL.
    if (name === '/ttl') {
      const configTtl = (app.config.get() as any).cache?.ttl as 'auto' | '5m' | '1h' | undefined;
      const resolved = app.resolvedTtl;
      if (arg === '5m' || arg === '1h') {
        // v3.0.5: app.tsx performs `await app.applyTtl(arg)` — the TTL now
        // really changes the wire format. It used to only update a display
        // value.
        return { handled: true, output: `✓ Cache TTL 已固定为 ${arg}（首次请求会重建缓存）`, action: 'apply_ttl', payload: arg };
      }
      const effective = resolved ?? (configTtl === 'auto' ? '1h' : (configTtl ?? '1h'));
      const lines = [
        '⏱  Cache TTL',
        '─────────────────────────',
        `  配置:      ${configTtl ?? '1h'}`,
        `  当前会话:  ${resolved ?? '尚未评估'}`,
        '',
        '说明: 默认 1 小时（长任务）。任务开始前无法预知长度，',
        '      5 分钟 TTL 会在长任务中途过期；1 小时缓存命中即可回本。',
        '      只有你确定会话很短时才建议 /ttl 5m。',
        '',
        '/ttl 5m|1h  调整 TTL',
      ];
      return { handled: true, output: lines.join('\n') };
    }

    // ── /skills [id] ────────────────────────────────────
    if (name === '/skills') {
      if (arg) {
        if (app.skills.isActive(arg)) {
          app.skills.deactivate(arg);
          return { handled: true, output: `✗ 已关闭: ${arg}` };
        } else if (app.skills.activate(arg)) {
          return { handled: true, output: `✓ 已开启: ${arg}` };
        }
        return { handled: true, output: `未知技能: ${arg}` };
      }

      const all = app.skills.list();
      const lines = [
        '技能列表:',
        ...all.map(s => {
          const mark = app.skills.isActive(s.id) ? '✓' : '·';
          return `  ${mark} ${s.id}  ${s.description}`;
        }),
        '',
        '用法: /技能 <id> 切换',
      ];
      return { handled: true, output: lines.join('\n') };
    }

    // ── /mcp ────────────────────────────────────────────
    if (name === '/mcp') {
      // v3.0.5: real status. This used to print a config example while the
      // MCP client was dead code.
      return { handled: true, output: app.mcpStatusText() };
    }

    // ── /thinking on|off ─────────────────────────────────
    if (name === '/thinking' || name === '/思考') {
      if (!arg) {
        return {
          handled: true,
          output: `思考块显示: ${app.showThinking ? '开启 (显示完整 <think>...</think>)' : '关闭 (压缩为单行提示)'}`,
        };
      }
      const want = arg.toLowerCase();
      if (want === 'on' || want === '开启' || want === 'true' || want === '1') {
        app.showThinking = true;
        return { handled: true, output: '✓ 已开启完整思考块显示' };
      }
      if (want === 'off' || want === '关闭' || want === 'false' || want === '0') {
        app.showThinking = false;
        return { handled: true, output: '✓ 已关闭思考块显示 (压缩为单行提示)' };
      }
      return { handled: true, output: `用法: /thinking on|off (当前: ${app.showThinking ? 'on' : 'off'})` };
    }

    // ── /help ───────────────────────────────────────────
    if (name === '/help') {
      return {
        handled: true,
        output: [
          '命令列表:',
          '  /模型 <名称>    切换模型（立即生效）',
          '  /models         模型设置：添加模型/上下文长度/思考强度',
          '  /服务商          更换服务商',
          '  /新建            新建会话（保留系统提示）',
          '  /resume [序号]   恢复历史会话',
          '  /压缩            压缩上下文（保留工具调用完整性）',
          '  /缓存            查看缓存命中率',
          '  /ttl 5m|1h       设置缓存 TTL（立即生效）',
          '  /思考 [on|off]   切换思考块显示',
          '  /技能 [id]       管理技能',
          '  /mcp             MCP 服务器状态',
          '  /yolo            切换写/执行操作自动确认',
          '  /帮助            查看帮助',
          '  exit             退出',
          '',
          '权限: 写/执行类工具调用默认需要确认（y 允许 / a 本会话全允许 / n 拒绝）。',
          '      启动时加 --yolo 或用 /yolo 可跳过确认。',
          '',
          '快捷键:',
          '  ↑/↓              历史记录',
          '  Ctrl+C           退出',
        ].join('\n'),
      };
    }

    return { handled: false };
  }, [app]);

  return { handleCommand };
}
