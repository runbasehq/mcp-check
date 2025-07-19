# mcp-testing-library

## Development

### Testing locally with pnpm link

To test this package in another project during development:

1. In this package directory, create a global symlink:
   ```bash
   pnpm link --global
   ```

2. In your test project, link to this package:
   ```bash
   pnpm link --global mcp-testing-library
   ```

3. When done testing, clean up the links:
   ```bash
   # In your test project
   pnpm unlink --global mcp-testing-library

   # In this package directory
   pnpm unlink --global
   ```

You can view all globally linked packages with:
```bash
pnpm list -g --depth=0
```
