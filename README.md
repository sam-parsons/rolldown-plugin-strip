# rolldown-plugin-strip

`rolldown-plugin-strip` is a Rolldown-native plugin for stripping debug-only code from production builds.

## Status

This repository is set up for issue-driven development. The implementation is intentionally incremental.

## Planned features

- Remove configured call expression statements (for example `console.log`).
- Remove `debugger` statements.
- Remove configured labeled blocks (`dev: { ... }`).
- Handle chained-call edge cases safely.

## Development

```bash
npm install
npm run check
npm run build
```
