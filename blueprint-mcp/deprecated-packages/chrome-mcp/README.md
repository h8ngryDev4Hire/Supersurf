# ⚠️ DEPRECATED: @railsblueprint/chrome-mcp

**This package has been renamed to `@railsblueprint/blueprint-mcp`**

## Migration Guide

### Why the rename?

The package was originally called `chrome-mcp` but now supports multiple browsers:
- ✅ Chrome
- ✅ Firefox
- ✅ Opera
- 🚧 Safari (coming soon)

The new name `blueprint-mcp` better reflects this multi-browser support.

### How to migrate

#### Option 1: Quick migration (Recommended)

Simply replace the package name in your configuration:

```bash
# Uninstall old package
npm uninstall @railsblueprint/chrome-mcp

# Install new package
npm install @railsblueprint/blueprint-mcp
```

#### Option 2: Using this compatibility wrapper

This package now acts as a compatibility wrapper that automatically installs `@railsblueprint/blueprint-mcp` and forwards all commands to it.

You can keep using `chrome-mcp` command and it will work, but we recommend migrating to the new package name.

### What's new in blueprint-mcp?

All the same features you know and love, plus:
- 🦊 Firefox support
- 🎭 Opera support
- 🧪 Safari support (in development)
- 📊 Memory monitoring tools
- 🔧 Performance improvements
- 🐛 Bug fixes

### Links

- **New package**: [@railsblueprint/blueprint-mcp](https://www.npmjs.com/package/@railsblueprint/blueprint-mcp)
- **Documentation**: https://blueprint-mcp.railsblueprint.com
- **GitHub**: https://github.com/railsblueprint/blueprint-mcp

### Support

For issues or questions, please use the new repository:
https://github.com/railsblueprint/blueprint-mcp/issues

---

**Please migrate to `@railsblueprint/blueprint-mcp` as this package will no longer receive updates.**
