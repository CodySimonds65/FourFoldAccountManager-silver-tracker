# Silver tracker

A plugin for [FourFold Account Manager](https://github.com/CodySimonds65/FourFoldAccountManager). For each open
account it shows the silver earned per hour, the session's earned and net totals, and a silver goal with the time it
takes at the current rate. An overlay card shows the same.

It is listed on the [plugin hub](https://github.com/CodySimonds65/FourFoldAccountManager-plugin-hub), so FourFold
users install it from the plugin list: the wrench in the plugin strip, then **Plugin hub**.

## As an example

Silver tracker is also a worked example for plugin authors. It shows:

- reading `fourfold.profile`, which needs `"apiVersion": 2` in `plugin.json`;
- keeping the maths in a module, `rate.mjs`, that touches neither the page nor `window.fourfold`;
- a check for that module that runs outside FourFold, in `.check/`. The hub leaves the folder out of the package,
  because its name starts with a dot.

To start your own plugin, use the
[plugin template](https://github.com/CodySimonds65/FourFoldAccountManager-plugin-template). The API is documented in
[PLUGIN_AUTHORS.md](https://github.com/CodySimonds65/FourFoldAccountManager/blob/main/PLUGIN_AUTHORS.md).

## Run it from source

1. In FourFold, open the plugin list (the wrench in the plugin strip), switch on **Developer mode**, and press
   **Open dev plugins folder**.
2. Clone this repository into that folder.

While developer mode is on, the copy in the dev folder runs instead of the one installed from the hub.

## Checks

Both need Node.js.

```bash
node .check/rate.check.mjs
```

```bash
npx -p typescript tsc -p jsconfig.json
```

The first checks the rate and goal maths. The second checks the scripts against `fourfold.d.ts`, which comes from the
plugin template along with `jsconfig.json` and gives an editor autocomplete and inline documentation for
`window.fourfold`.

## License

[Apache 2.0](LICENSE).
