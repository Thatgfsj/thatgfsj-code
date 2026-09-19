/** @jsxImportSource react */
import React from 'react';
import { Box, Text } from 'ink';
import { reportCrash } from '../../utils/crash.js';
import { theme } from '../theme.js';

interface State {
  error: Error | null;
}

/**
 * v3.2.0: top-level React error boundary around the whole TUI.
 *
 * Why it exists: the PlanPanel crash ("Cannot read properties of undefined
 * (reading 'items')") threw during a React render. Ink's reconciler catches
 * render errors before Node's process handlers see them, so the user got a
 * bare message + exit and `~/.thatgfsj/last-error.log` was never written —
 * leaving nothing to diagnose remotely. This boundary catches FIRST (it is
 * the nearest boundary), writes the full stack + component stack to disk,
 * shows one readable line, and exits.
 */
export class TuiErrorBoundary extends React.Component<
  { children?: React.ReactNode; /** false in tests — a real exit would kill the runner. */ autoExit?: boolean },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    reportCrash('tui-render', error, info.componentStack ?? undefined);
    if (this.props.autoExit === false) return;
    // Give Ink one frame to paint the message, then leave. cmd/index.tsx
    // restores the alt-screen in its exit cleanup.
    const t = setTimeout(() => process.exit(1), 250);
    t.unref?.();
  }

  render() {
    if (this.state.error) {
      return (
        <Box flexDirection="column" paddingX={1} paddingTop={1}>
          <Text color={theme.error}>✗ 界面渲染出错：{this.state.error.message}</Text>
          <Text color={theme.textFaint}>完整堆栈已写入 ~/.thatgfsj/last-error.log，欢迎附到 issue 里。</Text>
        </Box>
      );
    }
    return this.props.children;
  }
}
