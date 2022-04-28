/* eslint-disable newline-per-chained-call */
'use strict';

const { MessageEmbed, MessageActionRow, MessageButton, Permissions } = require('discord.js');
const { settings: guilds } = require('../data/config');

const guildCooldown = new Set();
const memberCooldown = new Set();
const interactionCooldown = new Set();

const BUTTONS = {
  '✏': 'change_name',
  '👥': 'change_limit',
  '🔒': 'lock_private',
  '🔓': 'open_private',
  '👑': 'transfer_ownership',
  '➕': 'add_member',
  '➖': 'remove_member',
  '❌': 'kick_member',
  '🔇': 'mute_member',
  '🔊': 'unmute_member',
};

exports.checkMainMessage = async client => {
  for await (const guildSettings of Object.entries(guilds)) {
    const [guildId, settings] = guildSettings;
    if (!settings || !guildId) throw new Error('Настройки не найдены.');
    if (!settings.category || !settings.text_channel) throw new Error('Необходимые настройки не найдены!');

    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw new Error('Указанный сервер не найден.');

    const channel = guild.channels.cache.get(settings.text_channel);
    if (!channel) throw new Error('Указанный канал не найден.');

    const messages = await channel.messages.fetch({ limit: 10 });
    if (!messages.some(message => message.author.id === client.user.id) || !messages.size) {
      const embed = new MessageEmbed()
        .setTitle('Управление комнатой')
        .setColor(0x4a36bf)
        .setDescription(`Используй кнопки ниже для настройки своей комнаты\n\n${translateButtons()}`);

      // Разделяем, так как в 1 ряде действий максимум - 5 кнопок.
      const components = [];
      for (const [key, value] of Object.entries(BUTTONS)) {
        components.push(new MessageButton().setCustomId(value).setEmoji(key).setStyle('SECONDARY'));
      }

      // Отправка сообщения
      await channel.send({
        embeds: [embed],
        components: [
          new MessageActionRow().addComponents(...components.slice(0, 5)),
          new MessageActionRow().addComponents(...components.slice(5, 10)),
        ],
      });
    }
  }
};

exports.handleVoiceState = async (client, oldState, newState) => {
  const guild = newState.guild;

  const settings = guilds[guild.id];
  if (!settings) return console.error('Настройки для сервера не найдены.');

  const { category: categoryID, voice_channel, cooldown } = settings;

  const category = guild.channels.cache.get(categoryID);
  if (!category) return console.error('Категория приватов не найдена.');

  const channel = guild.channels.cache.get(voice_channel);
  if (!channel) return console.error('Родительский канал приватов не найден.');

  // Если пользователь отключился
  if (oldState.channel) {
    if (
      oldState.channel.id !== channel.id &&
      oldState.channel.parent?.id === category.id &&
      oldState.channel.members.every(m => m.user.bot)
    ) {
      if (!guild.me.permissions.any([16n, 8n])) return console.error('У бота нет прав для удаления канала!');
      const owner = oldState.channel.permissionOverwrites.cache.find(p => p.allow.has('MANAGE_CHANNELS', false));

      log('delete', guild.members.resolve(owner.id), oldState.channel);
      oldState.channel.delete();
    }
  }

  // Если пользователь подключился
  if (newState.channel) {
    if (newState.channel.id === channel.id) {
      if (!guild.me.permissions.any([16777216n, 8n])) {
        return console.error('У бота нет прав для перемещения участника!');
      }
      if (guildCooldown.has(guild.id)) {
        sendError(newState.member);
        newState.disconnect();
      } else if (memberCooldown.has(newState.member.id)) {
        sendError(newState.member);
        newState.disconnect();
      }

      if (category.children.some(ch => ch.permissionOverwrites.cache.some(p => p.id === newState.member.id))) {
        newState.setChannel(
          category.children.find(ch => ch.permissionOverwrites.cache.some(p => p.id === newState.member.id)),
        );
      }

      guildCooldown.add(guild.id);
      memberCooldown.add(newState.member.id);

      setTimeout(() => {
        guildCooldown.delete(guild.id);
      }, cooldown.guild);
      setTimeout(() => {
        memberCooldown.delete(newState.member.id);
      }, cooldown.member);

      const ch = await guild.channels.create(newState.member.displayName, {
        type: 'GUILD_VOICE',
        parent: category,
        permissionOverwrites: [
          ...category.permissionOverwrites.cache.toJSON(),
          {
            id: newState.member.id,
            allow: ['CONNECT', 'SPEAK', 'USE_VAD', 'MANAGE_CHANNELS', 'MOVE_MEMBERS', 'STREAM'],
          },
        ],
      });

      await newState.setChannel(ch);
      log('create', newState.member, newState.channel);
    }
  }
  return null;
};

exports.handleInteraction = (client, interaction) => {
  if (!interaction.isButton()) return;

  const memberVoice = interaction.member.voice?.channel;
  if (!memberVoice) {
    interaction.reply({ content: 'У вас нет своей комнаты!', ephemeral: true });
    return;
  }

  const voiceOwner = memberVoice.permissionOverwrites.cache.find(p => p.allow.has('MANAGE_CHANNELS', false));
  if (voiceOwner.id !== interaction.user.id) {
    interaction.reply({ content: 'Вы не влделец комнаты!', ephemeral: true });
    return;
  }

  if (interactionCooldown.has(interaction.user.id)) {
    interaction.reply({ content: 'Сейчас вы не можете использовать данную кнопку!', ephemeral: true });
    return;
  }

  const settings = guilds[interaction.guild.id];
  if (!settings) {
    console.error('Настройки для сервера не найдены.');
    return;
  }

  const { cooldown } = settings;

  interactionCooldown.add(interaction.user.id);

  setTimeout(() => {
    interactionCooldown.delete(interaction.user.id);
  }, cooldown.interaction);

  if (interaction.customId === 'change_name') {
    actions(interaction, 'В следующем сообщении напишите новое название канала!', 'setname');
  } else if (interaction.customId === 'change_limit') {
    actions(interaction, 'В следующем сообщении напишите новый лимит для канала!', 'setlimit');
  } else if (interaction.customId === 'lock_private' || interaction.customId === 'open_private') {
    const bool = interaction.customId === 'open_private';

    interaction.reply({
      embeds: [
        new MessageEmbed()
          .setColor(bool ? 0x27cf46 : 0xc9532e)
          .setDescription(`Комната ${bool ? 'открыта' : 'закрыта'}!`),
      ],
      ephemeral: true,
    });

    interaction.member.voice.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
      CONNECT: bool,
    });

    log('edit', interaction.member, interaction.channel, {
      change: 'доступ',
      newvalue: `${bool ? 'Открыт' : 'Закрыт'} всем`,
    });
  } else if (interaction.customId === 'transfer_ownership') {
    actions(interaction, 'В следующем сообщении упомяните нового владельца комнаты!', interaction.customId, true);
  } else if (interaction.customId === 'add_member' || interaction.customId === 'remove_member') {
    actions(
      interaction,
      `В следующем сообщении упомяните участника которого хотите ${
        interaction.customId === 'add_member' ? 'добавить в комнату' : 'убрать из комнаты'
      }!`,
      interaction.customId,
      true,
    );
  } else if (interaction.customId === 'kick_member') {
    actions(
      interaction,
      'В следующем сообщении упомяните участника которого хотите выгнать из комнаты!',
      interaction.customId,
      true,
    );
  } else if (interaction.customId === 'mute_member' || interaction.customId === 'unmute_member') {
    actions(
      interaction,
      `В следующем сообщении упомяните участника которого хотите ${
        interaction.customId === 'mute_member' ? 'замутить' : 'размутить'
      } в комнате!`,
      interaction.customId,
      true,
    );
  }
};

exports.checkParentPrivate = client => {
  // Проверка родительского канала на забитость
  for (const guildSettings of Object.entries(guilds)) {
    const [guildId, settings] = guildSettings;
    if (!settings || !guildId) throw new Error('Настройки не найдены.');
    if (!settings.voice_channel) throw new Error('Не указан голосовой канал для проверки!');

    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw new Error('Указанный сервер не найден.');

    const channel = guild.channels.cache.get(settings.voice_channel);
    if (!channel) throw new Error('Указанный канал не найден.');

    if (channel.members.size === 0) return;

    const oldMember = channel.members.first();

    setTimeout(() => {
      const newMember = guild.channels.cache.get(settings.voice_channel).members.first();
      if (oldMember === newMember) {
        oldMember?.voice?.disconnect();
      }
    }, 5000);
  }
};

exports.checkChildChannels = async client => {
  // Проверка пустых каналов категории.

  for await (const guildSettings of Object.entries(guilds)) {
    const [guildId, settings] = guildSettings;
    if (!settings || !guildId) throw new Error('Настройки не найдены.');
    if (!settings.category) throw new Error('Не указана категория приватов для проверки!');

    const { category: categoryID, voice_channel } = settings;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) throw new Error('Указанный сервер не найден.');

    const category = guild.channels.cache.get(categoryID);
    if (!category) throw new Error('Указанный канал не найден.');

    category.children.forEach(channel => {
      if (channel.type !== 'GUILD_VOICE' || channel.id === voice_channel) return;
      if (!channel.members.every(m => m.user.bot)) return;
      const owner = channel.permissionOverwrites.cache.find(p => p.allow.has('MANAGE_CHANNELS', false));

      log('delete', guild.members.resolve(owner.id), channel);
      channel.delete();
    });
  }
};

function translateButtons() {
  const translates = {
    change_name: 'Изменить название комнаты',
    change_limit: 'Установить лимит пользователей',
    lock_private: 'Закрыть комнату для всех',
    open_private: 'Открыть комнату для всех',
    transfer_ownership: 'Передать права владения комнатой',
    add_member: 'Выдать участнику доступ в комнату',
    remove_member: 'Забрать у участника доступ к комнате',
    kick_member: 'Выгнать участника из комнаты',
    mute_member: 'Замутить участника в комнате',
    unmute_member: 'Размутить участника в комнате',
  };

  const translated = [];

  for (const [key, value] of Object.entries(BUTTONS)) {
    translated.push(`**${key} - \`${translates[value] ?? 'Не указано'}\`**`);
  }

  return translated.join('\n');
}

function sendError(member) {
  try {
    member.send({
      embeds: [
        new MessageEmbed()
          .setColor(0xed3434)
          .setTitle('⛔ | Произошла ошибка')
          .setDescription('В данный момент вы не можете создать/изменить комнату!'),
      ],
    });
  } catch (err) {
    console.error(err);
  }
}

function actions(interaction, text, action, member = false) {
  interaction.reply({
    embeds: [
      new MessageEmbed().setDescription(text).setFooter({ text: 'У вас 1 минута, иначе действие будет отменено.' }),
    ],
    ephemeral: true,
    fetch: true,
  });

  const isAdmin = interaction.member.permissions.has(Permissions.FLAGS.ADMINISTRATOR);

  const filter = m => m.author.id === interaction.user.id;
  interaction.channel
    .awaitMessages({ filter, max: 1, time: 60 * 1000, errors: ['time'] })
    .then(messages => {
      const value = member ? messages.first().mentions.members.first() : messages.first().content;
      if (isAdmin) messages.first().delete();
      if (!value) return;
      if (action === 'setname') {
        interaction.member.voice.channel.setName(value);

        interaction.editReply({
          embeds: [new MessageEmbed().setColor('GREEN').setDescription('Название успешно изменено!')],
        });

        log('edit', interaction.member, interaction.member.voice.channel, {
          change: 'название',
          oldvalue: interaction.member.voice.channel.name,
          newvalue: value,
        });
      } else if (action === 'setlimit') {
        interaction.member.voice.channel.setUserLimit(+value);

        interaction.editReply({
          embeds: [new MessageEmbed().setColor('GREEN').setDescription('Лимит успешно изменено!')],
        });

        log('edit', interaction.member, interaction.member.voice.channel, {
          change: 'лимит',
          oldvalue: interaction.member.voice.channel.userLimit,
          newvalue: value,
        });
      } else if (action === 'transfer_ownership') {
        const voiceOwner = interaction.member.voice.channel.permissionOverwrites.cache.find(p =>
          p.allow.has('MANAGE_CHANNELS', false),
        );

        interaction.member.voice.channel.permissionOverwrites.edit(voiceOwner.id, {
          MANAGE_CHANNELS: false,
          MOVE_MEMBERS: false,
        });

        interaction.member.voice.channel.permissionOverwrites.edit(value.id, {
          CONNECT: true,
          SPEAK: true,
          USE_VAD: true,
          MANAGE_CHANNELS: true,
          MOVE_MEMBERS: true,
          STREAM: true,
        });

        interaction.editReply({
          embeds: [new MessageEmbed().setColor('GREEN').setDescription('Права владения комнатой успешно переданы!')],
        });

        log('edit', interaction.member, interaction.member.voice.channel, {
          change: 'владелец',
          oldvalue: `<@${voiceOwner.id}> \`[${voiceOwner.id}]\``,
          newvalue: `${value} \`[${value.id}]\``,
        });
      } else if (action === 'add_member' || action === 'remove_member') {
        interaction.member.voice.channel.permissionOverwrites.edit(value.id, {
          CONNECT: action === 'add_member',
        });

        interaction.editReply({
          embeds: [
            new MessageEmbed()
              .setColor('GREEN')
              .setDescription(`Участник ${value} успешно изменено ${action === 'add_member' ? 'добавлен' : 'убран'}!`),
          ],
        });

        log('edit', interaction.member, interaction.member.voice.channel, {
          change: 'право для',
          oldvalue: action === 'add_member' ? undefined : value,
          newvalue: action === 'add_member' ? value : undefined,
        });
      } else if (action === 'kick_member') {
        const voiceOwner = interaction.member.voice.channel.permissionOverwrites.cache.find(p =>
          p.allow.has('MANAGE_CHANNELS', false),
        );

        if (voiceOwner.id === value.id) return;
        value.voice.disconnect();

        interaction.editReply({
          embeds: [new MessageEmbed().setColor('RED').setDescription(`Участник ${value} выгнан из вашей комнаты!`)],
        });

        log('edit', interaction.member, interaction.member.voice.channel, {
          change: 'участник',
          oldvalue: `${value} \`[${value.id}]\``,
        });
      } else if (action === 'mute_member' || action === 'unmute_member') {
        const voiceOwner = interaction.member.voice.channel.permissionOverwrites.cache.find(p =>
          p.allow.has('MANAGE_CHANNELS', false),
        );
        if (voiceOwner.id === value.id) return;

        interaction.member.voice.channel.permissionOverwrites.edit(value.id, {
          SPEAK: interaction.customId === 'unmute_member',
        });

        interaction.editReply({
          embeds: [
            new MessageEmbed()
              .setColor('RED')
              .setDescription(`Участник ${value} ${action === 'mute_member' ? 'замучен' : 'размучен'}!`),
          ],
        });

        log('edit', interaction.member, interaction.member.voice.channel, {
          change: 'мут',
          oldvalue: action === 'mute_member' ? undefined : `${value} \`[${value.id}]\``,
          newvalue: action === 'mute_member' ? `${value} \`[${value.id}]\`` : undefined,
        });
      }
    })
    .catch();
}

function log(type, member, channel, details) {
  const types = {
    create: { title: 'Создание комнаты', color: 0x57f288 },
    edit: { title: 'Изменение комнаты', color: 0xe18c47 },
    delete: { title: 'Удаление комнаты', color: 0xd54043 },
  };

  if (!types[type]) throw new Error('Указанный тип логов не найден.');
  const embed = new MessageEmbed().setTitle(types[type].title).setColor(types[type].color).setTimestamp();

  const fields = [
    { name: 'Владелец комнаты', value: member ? `<@${member.id}> \`[${member.id}]\`` : 'Неизвестный участник' },
    { name: 'Комната', value: `${channel.name} \`[${channel.id}]\`` },
  ];

  if (details?.oldvalue) {
    fields.push({ name: `Старое(-ый) ${details.change}`, value: `${details.oldvalue}`, inline: true });
  }

  if (details?.newvalue) {
    fields.push({ name: `Новое(-ый) ${details.change}`, value: `${details.newvalue}`, inline: true });
  }

  embed.setFields(fields);

  try {
    const logChannel =
      member?.guild?.channels.cache.get(guilds[member.guild.id]?.log) ||
      channel?.guild?.channels.cache.get(guilds[channel.guild.id]?.log);

    logChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error(err);
  }
}
