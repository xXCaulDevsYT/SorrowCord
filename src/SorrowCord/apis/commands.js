const { API } = require('sorrowcord/entities');

class CommandsAPI extends API {
  constructor () {
    super();

    this.commands = {};
  }

  get prefix () {
    return sorrowcord.settings.get('prefix', '.');
  }

  get find () {
    const arr = Object.values(this.commands);
    return arr.find.bind(arr);
  }

  get filter () {
    const arr = Object.values(this.commands);
    return arr.filter.bind(arr);
  }

  get map () {
    const arr = Object.values(this.commands);
    return arr.map.bind(arr);
  }

  get sort () {
    const arr = Object.values(this.commands);
    return arr.sort.bind(arr);
  }

  /**
   * Registers a command
   * @param {PowercordChatCommand} command Command to register
   */
  registerCommand (command) {
    // @todo: remove this once there's a proper implemention (if any) for fetching the command origin.
    const stackTrace = (new Error()).stack;
    const [ , origin ] = stackTrace.match(new RegExp(`${global._.escapeRegExp(sorrowcord.pluginManager.pluginDir)}.([-\\w]+)`));

    if (typeof command === 'string') {
      console.error('no');
      return;
    }
    if (this.commands[command.command]) {
      throw new Error(`Command ${command.command} is already registered!`);
    }

    this.commands[command.command] = {
      ...command,
      origin
    };
  }

  /**
   * Unregisters a command
   * @param {String} command Command name to unregister
   */
  unregisterCommand (command) {
    if (this.commands[command]) {
      delete this.commands[command];
    }
  }
}

module.exports = CommandsAPI;
