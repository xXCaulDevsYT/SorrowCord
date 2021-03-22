const { join } = require('path');
const { shell: { openExternal } } = require('electron');
const { get } = require('sorrowcord/http');
const { sleep } = require('sorrowcord/util');
const Webpack = require('sorrowcord/webpack');
const { WEBSITE } = require('sorrowcord/constants');
const { Updatable } = require('sorrowcord/entities');

const { promisify } = require('util');
const cp = require('child_process');
const exec = promisify(cp.exec);

const PluginManager = require('./managers/plugins');
const StyleManager = require('./managers/styles');
const APIManager = require('./managers/apis');
const modules = require('./modules');
let coremods;

class Sorrowcord extends Updatable {
  constructor () {
    super(join(__dirname, '..', '..'), '', 'powercord');

    this.api = {};
    this.gitInfos = {
      upstream: '???',
      branch: '???',
      revision: '???'
    };
    this.initialized = false;
    this.styleManager = new StyleManager();
    this.pluginManager = new PluginManager();
    this.apiManager = new APIManager();
    this.account = null;
    this.isLinking = false;
    // this.hookRPCServer();

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.init());
    } else {
      this.init();
    }
  }

  // Powercord initialization
  async init () {
    const isOverlay = (/overlay/).test(location.pathname);
    if (isOverlay) { // eh
      // await sleep(250);
    }

    // Webpack & Modules
    await Webpack.init();
    await Promise.all(modules.map(mdl => mdl()));

    // Start
    await this.startup();
    this.fetchAccount();
    this.gitInfos = await this.pluginManager.get('pc-updater').getGitInfos();

    // Token manipulation stuff
    if (this.settings.get('hideToken', true)) {
      const tokenModule = await require('powercord/webpack').getModule([ 'hideToken' ]);
      tokenModule.hideToken = () => void 0;
      setImmediate(() => tokenModule.showToken()); // just to be sure
    }

    window.addEventListener('beforeunload', () => {
      if (this.account && this.settings.get('settingsSync', false)) {
        sorrowcord.api.settings.upload();
      }
    });

    // Patch bootstrap logic
    if (process.platform === 'win32' && DiscordNative.nativeModules.canBootstrapNewUpdater) {
      this.patchBootstrapUpdater();
    }

    this.emit('loaded');
  }

  // Powercord startup
  async startup () {
    // APIs
    await this.apiManager.startAPIs();
    this.settings = sorrowcord.api.settings.buildCategoryObject('pc-general');
    this.emit('settingsReady');

    // Style Manager
    this.styleManager.loadThemes();

    // Plugins
    coremods = require('./coremods');
    await coremods.load();
    await this.pluginManager.startPlugins();

    this.initialized = true;
  }

  // Powercord shutdown
  async shutdown () {
    this.initialized = false;
    // Plugins
    await this.pluginManager.shutdownPlugins();
    await coremods.unload();

    // Style Manager
    this.styleManager.unloadThemes();

    // APIs
    await this.apiManager.unload();
  }

  // Bad code
  async hookRPCServer () {
    const _this = this;
    // eslint-disable-next-line no-unmodified-loop-condition
    while (!global.DiscordNative) {
      await sleep(1);
    }

    await DiscordNative.nativeModules.ensureModule('discord_rpc');
    const discordRpc = DiscordNative.nativeModules.requireModule('discord_rpc');
    const { createServer } = discordRpc.RPCWebSocket.http;
    discordRpc.RPCWebSocket.http.createServer = function () {
      _this.rpcServer = createServer();
      return _this.rpcServer;
    };
  }

  async patchBootstrapUpdater () {
    const { inject } = require('../../injectors/main');
    const injector = require(`../../injectors/${process.platform}`);

    await DiscordNative.nativeModules.ensureModule('discord_updater_bootstrap');

    const BootstrapUpdater = DiscordNative.nativeModules.requireModule('discord_updater_bootstrap');
    BootstrapUpdater.finishBootstrap = (({ finishBootstrap }) => () => {
      inject(injector).then(() => finishBootstrap());
    })(BootstrapUpdater);
  }

  async fetchAccount () {
    if (this.isLinking) {
      while (this.isLinking) {
        await sleep(1);
      }
      return;
    }

    this.isLinking = true;
    const token = this.settings.get('sorrowcordToken', null);
    if (token) {
      const baseUrl = this.settings.get('backendURL', WEBSITE);
      console.debug('%c[Sorrowcord]', 'color: #7289da', 'Logging in to your account...');

      const resp = await get(`${baseUrl}/api/v2/users/@me`)
        .set('Authorization', token)
        .catch(e => e);

      if (resp.statusCode === 401) {
        if (!resp.body.error && resp.body.error !== 'DISCORD_REVOKED') {
          powercord.api.notices.sendAnnouncement('pc-account-discord-unlinked', {
            color: 'red',
            message: 'Your Sorrowcord account is no longer linked to your Discord account! Some integrations will be disabled.',
            button: {
              text: 'Link it back',
              onClick: () => openExternal(`${WEBSITE}/api/v2/oauth/discord`)
            }
          });

          this.isLinking = false;
          return; // keep token stored
        }
        this.settings.set('sorrowcordToken', null);
        this.account = null;
        this.isLinking = false;
        return console.error('%c[Sorrowcord]', 'color: #7289da', 'Unable to fetch your account (Invalid token). Removed token from config');
      } else if (resp.statusCode !== 200) {
        this.account = null;
        this.isLinking = false;
        return console.error('%c[Sorrowcord]', 'color: #7289da', `An error occurred while fetching your account: ${resp.statusCode} - ${resp.statusText}`, resp.body);
      }

      this.account = resp.body;
      this.account.token = token;
    } else {
      this.account = null;
    }
    console.debug('%c[Sorrowcord]', 'color: #7289da', 'Logged in!');
    this.isLinking = false;
  }

  async _update (force = false) {
    const success = await super._update(force);
    if (success) {
      await exec('npm install --only=prod', { cwd: this.entityPath });
      const updater = this.pluginManager.get('pc-updater');
      if (!document.querySelector('#sorrowcord-updater, .sorrowcord-updater')) {
        powercord.api.notices.sendToast('sorrowcord-updater', {
          header: 'Update complete!',
          content: 'Please click "Reload" to complete the final stages of this Sorrowcord update.',
          type: 'success',
          buttons: [ {
            text: 'Reload',
            color: 'green',
            look: 'ghost',
            onClick: () => location.reload()
          }, {
            text: 'Postpone',
            color: 'grey',
            look: 'outlined'
          } ]
        });
      }
      updater.settings.set('awaiting_reload', true);
    }
    return success;
  }
}

module.exports = Sorrowcord;
