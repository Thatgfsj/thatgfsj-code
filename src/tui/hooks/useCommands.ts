import { useCallback } from 'react';
import type { App } from '../../app/index.js';

interface CommandResult {
  handled: boolean;
  output?: string;
  action?: 'clear' | 'reinit';
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
};

export const COMMAND_LIST = [
  { name: '/模型', desc: '切换模型' },
  { name: '/服务商', desc: '更换服务商' },
  { name: '/新建', desc: '新建会话' },
  { name: '/压缩', desc: '压缩上下文' },
  { name: '/缓存', desc: '缓存命中率' },
  { name: '/ttl', desc: '查看/设置 Cache TTL' },
  { name: '/技能', desc: '管理技能' },
  { name: '/mcp', desc: 'MCP 设置' },
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
      return { handled: true, output: `模型 → ${arg}` };
    }

    // ── /provider ───────────────────────────────────────
    if (name === '/provider') {
      return { handled: true, action: 'reinit' };
    }

    // ── /new, /clear ────────────────────────────────────
    if (name === '/new') {
      app.session.clear();
      return { handled: true, output: '新会话已创建。', action: 'clear' };
    }

    // ── /compact ────────────────────────────────────────
    if (name === '/compact') {
      const before = app.session.getMessageCount();
      app.session.truncate();
      const after = app.session.getMessageCount();
      return { handled: true, output: `上下文已压缩: ${before} → ${after} 条消息` };
    }

    // ── /cache — prompt cache hit-rate + cost savings ───
    // v3.0.0: surfaces CacheStatsStore snapshots. Sub-commands:
    //   /cache          show full breakdown
    //   /cache reset    zero the persistent stats
    if (name === '/cache') {
      if (arg === 'reset' || arg === '重置') {
        app.cacheStats.reset();
        return { handled: true, output: '✓ 缓存统计已重置' };
      }
      if (arg === 'off' || arg === '关') {
        // Toggle disable: writes through to provider config (currently a
        // no-op until M4.5 wires Config.cache). Print a hint.
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
    //
    //   /ttl              show current effective TTL + decision reason
    //   /ttl 5m|1h        pin TTL for this session (sticky, no cache reset)
    //   /ttl auto         resume auto-decision (clears the pin)
    if (name === '/ttl') {
      const configTtl = (app.config.get() as any).cache?.ttl as 'auto' | '5m' | '1h' | undefined;
      const resolved = app.resolvedTtl;
      if (arg === 'auto') {
        app.config.save({ cache: { ...(app.config.get() as any).cache, ttl: 'auto' } });
        app.resolvedTtl = null;
        return { handled: true, output: '✓ Cache TTL 已重置为自动（下一轮重新评估）' };
      }
      if (arg === '5m' || arg === '1h') {
        app.config.save({ cache: { ...(app.config.get() as any).cache, ttl: arg } });
        app.resolvedTtl = arg;
        return { handled: true, output: `✓ Cache TTL 已固定为 ${arg}（首次请求会重建缓存）` };
      }
      // No arg: show current state
      const lines = [
        '⏱  Cache TTL',
        '─────────────────────────',
        `  配置:      ${configTtl ?? 'auto'}`,
        `  当前会话:  ${resolved ?? '尚未评估'}`,
        '',
        '说明: '+
          (configTtl === 'auto'
            ? '自动模式 – 短会话(≤14 轮)用 5m节省写入成本，' +
              '长会话(≥15 轮 或 ≥50k 字符)自动升级到 1h 复用缓存。'
            : `${configTtl} 模式 – TTL 每次请求都固定。`),
        '',
        '/ttl 5m|1h|auto  调整 TTL',
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
      return {
        handled: true,
        output: [
          'MCP 配置: ~/.thatgfsj/mcp.json',
          '',
          '  {',
          '    "servers": {',
          '      "名称": { "command": "npx", "args": ["-y", "server"] }',
          '    }',
          '  }',
        ].join('\n'),
      };
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
          '  /模型 <名称>    切换模型',
          '  /服务商          更换服务商',
          '  /新建            新建会话',
          '  /压缩            压缩上下文',
          '  /缓存            查看缓存命中率',
          '  /思考 [on|off]   切换思考块显示',
          '  /技能 [id]       管理技能',
          '  /mcp             MCP 设置',
          '  /帮助            查看帮助',
          '  exit             退出',
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
