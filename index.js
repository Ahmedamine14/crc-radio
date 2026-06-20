require("dotenv").config();
process.env.FFMPEG_PATH = require("ffmpeg-static");

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ActivityType,
} = require("discord.js");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
  NoSubscriberBehavior,
} = require("@discordjs/voice");

const { spawn } = require("child_process");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

const STATIONS = {
  mars: {
    name: "Radio Mars",
    emoji: "⚽",
    url: "http://radiomars.ice.infomaniak.ch/radiomars-128.mp3",
    description: "Moroccan sports radio",
  },
  hitradio: {
    name: "Hit Radio Maroc",
    emoji: "🔥",
    url: "http://hitradio-maroc.ice.infomaniak.ch/hitradio-maroc-128.mp3",
    description: "Moroccan music and hits",
  },
  medradio: {
    name: "Med Radio",
    emoji: "🎙️",
    url: "http://medradio-maroc.ice.infomaniak.ch/medradio-maroc-64.mp3",
    description: "Moroccan news and talk",
  },
  medina: {
    name: "Medina FM",
    emoji: "🌆",
    url: "http://medinafm.ice.infomaniak.ch/medinafm-128.mp3",
    description: "Moroccan radio station",
  },
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

let connection = null;
let currentStationKey = null;
let currentVolume = 0.5;
let isMuted = false;
let ffmpegProcess = null;

const player = createAudioPlayer({
  behaviors: {
    noSubscriber: NoSubscriberBehavior.Play,
  },
});

function stopFfmpeg() {
  if (ffmpegProcess) {
    ffmpegProcess.kill("SIGKILL");
    ffmpegProcess = null;
  }
}

function makeResource(url) {
  stopFfmpeg();

  ffmpegProcess = spawn(process.env.FFMPEG_PATH, [
    "-reconnect", "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "5",
    "-user_agent", "Mozilla/5.0",
    "-headers", "Icy-MetaData: 0\r\n",
    "-i", url,
    "-vn",
    "-f", "s16le",
    "-ar", "48000",
    "-ac", "2",
    "pipe:1",
  ]);

  console.log("FFmpeg started for:", url);

  ffmpegProcess.stderr.on("data", data => {
    console.error("FFmpeg:", data.toString());
  });

  ffmpegProcess.on("close", (code, signal) => {
    console.log("FFmpeg closed. Code:", code, "Signal:", signal);
  });

  const resource = createAudioResource(ffmpegProcess.stdout, {
    inputType: StreamType.Raw,
    inlineVolume: true,
  });

  resource.volume.setVolume(isMuted ? 0 : currentVolume);
  return resource;
}

function makeEmbed(title, description) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(0xf1c40f)
    .setFooter({ text: "CRC RADIO • Moroccan Radio Network" })
    .setTimestamp();
}

function stationEmbed(station) {
  return makeEmbed(
    `${station.emoji} CRC RADIO`,
    `Now playing: **${station.name}**\n\n${station.description}\n\nVolume: **${Math.round(currentVolume * 100)}%**`
  );
}

function stationMenu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("station_select")
      .setPlaceholder("Choose a Moroccan station")
      .addOptions(
        Object.entries(STATIONS).map(([key, station]) => ({
          label: station.name,
          description: station.description,
          value: key,
          emoji: station.emoji,
        }))
      )
  );
}

async function connect(interaction) {
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const voiceChannel = member.voice.channel;

  if (!voiceChannel) {
    throw new Error("NO_VOICE_CHANNEL");
  }

  if (connection) {
    connection.destroy();
    connection = null;
  }

  connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: interaction.guild.id,
    adapterCreator: interaction.guild.voiceAdapterCreator,
    selfDeaf: false,
  });

  connection.on(VoiceConnectionStatus.Disconnected, () => {
    connection = null;
  });

  connection.subscribe(player);
}

async function playStation(key) {
  const station = STATIONS[key];
  if (!station || !connection) return;

  currentStationKey = key;

  const resource = makeResource(station.url);
  player.play(resource);

  console.log("Playing station:", station.name);
}

function stopRadio() {
  currentStationKey = null;
  player.stop();
  stopFfmpeg();
}

player.on(AudioPlayerStatus.Playing, () => {
  console.log("Player is playing audio.");
});

player.on(AudioPlayerStatus.Idle, () => {
  console.log("Player went idle.");
});

player.on("error", error => {
  console.error("Player error:", error.message);
});

client.once("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  client.user.setActivity("CRC RADIO", {
    type: ActivityType.Listening,
  });

  const commands = [
    new SlashCommandBuilder().setName("radio").setDescription("Open station selector"),
    new SlashCommandBuilder().setName("mars").setDescription("Play Radio Mars"),
    new SlashCommandBuilder().setName("hitradio").setDescription("Play Hit Radio Maroc"),
    new SlashCommandBuilder().setName("medradio").setDescription("Play Med Radio"),
    new SlashCommandBuilder().setName("medina").setDescription("Play Medina FM"),
    new SlashCommandBuilder().setName("nowplaying").setDescription("Show current station"),
    new SlashCommandBuilder().setName("stop").setDescription("Stop radio"),
    new SlashCommandBuilder().setName("join").setDescription("Join your voice channel"),
    new SlashCommandBuilder().setName("leave").setDescription("Leave voice channel"),
    new SlashCommandBuilder().setName("restart").setDescription("Restart current station"),
    new SlashCommandBuilder().setName("stations").setDescription("List available stations"),
    new SlashCommandBuilder().setName("helpcrc").setDescription("Show CRC RADIO commands"),
    new SlashCommandBuilder().setName("mute").setDescription("Mute radio"),
    new SlashCommandBuilder().setName("unmute").setDescription("Unmute radio"),
    new SlashCommandBuilder().setName("status").setDescription("Show CRC RADIO status"),
    new SlashCommandBuilder()
      .setName("volume")
      .setDescription("Change volume from 0 to 200")
      .addIntegerOption(option =>
        option.setName("value").setDescription("Example: 50").setRequired(true)
      ),
  ].map(command => command.toJSON());

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
    body: commands,
  });

  console.log("CRC RADIO commands registered");
});

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isStringSelectMenu()) {
      await interaction.deferReply();

      await connect(interaction);

      const stationKey = interaction.values[0];
      await playStation(stationKey);

      return interaction.editReply({
        embeds: [stationEmbed(STATIONS[stationKey])],
      });
    }

    if (!interaction.isChatInputCommand()) return;

    await interaction.deferReply();

    const cmd = interaction.commandName;

    if (cmd === "radio") {
      return interaction.editReply({
        content: "Choose a station:",
        components: [stationMenu()],
      });
    }

    if (["mars", "hitradio", "medradio", "medina"].includes(cmd)) {
      await connect(interaction);
      await playStation(cmd);

      return interaction.editReply({
        embeds: [stationEmbed(STATIONS[cmd])],
      });
    }

    if (cmd === "join") {
      await connect(interaction);
      return interaction.editReply("CRC RADIO joined your voice channel.");
    }

    if (cmd === "leave") {
      stopRadio();

      if (connection) {
        connection.destroy();
        connection = null;
      }

      return interaction.editReply("CRC RADIO left the voice channel.");
    }

    if (cmd === "stop") {
      stopRadio();
      return interaction.editReply("Radio stopped.");
    }

    if (cmd === "restart") {
      if (!currentStationKey) {
        return interaction.editReply("No station is currently playing.");
      }

      await playStation(currentStationKey);
      return interaction.editReply("Current station restarted.");
    }

    if (cmd === "nowplaying") {
      if (!currentStationKey) {
        return interaction.editReply("Nothing is playing right now.");
      }

      return interaction.editReply({
        embeds: [stationEmbed(STATIONS[currentStationKey])],
      });
    }

    if (cmd === "stations") {
      const list = Object.values(STATIONS)
        .map(station => `${station.emoji} **${station.name}** — ${station.description}`)
        .join("\n");

      return interaction.editReply({
        embeds: [makeEmbed("Available CRC RADIO Stations", list)],
      });
    }

    if (cmd === "helpcrc") {
      return interaction.editReply({
        embeds: [
          makeEmbed(
            "CRC RADIO Commands",
            "`/radio` — Open station selector\n" +
              "`/mars` — Play Radio Mars\n" +
              "`/hitradio` — Play Hit Radio Maroc\n" +
              "`/medradio` — Play Med Radio\n" +
              "`/medina` — Play Medina FM\n" +
              "`/nowplaying` — Show current station\n" +
              "`/stop` — Stop radio\n" +
              "`/join` — Join voice channel\n" +
              "`/leave` — Leave voice channel\n" +
              "`/restart` — Restart current station\n" +
              "`/stations` — List stations\n" +
              "`/volume value:50` — Change volume\n" +
              "`/mute` — Mute radio\n" +
              "`/unmute` — Unmute radio\n" +
              "`/status` — Bot status"
          ),
        ],
      });
    }

    if (cmd === "volume") {
      const value = interaction.options.getInteger("value");

      if (value < 0 || value > 200) {
        return interaction.editReply("Volume must be between 0 and 200.");
      }

      currentVolume = value / 100;
      isMuted = false;

      if (currentStationKey) {
        await playStation(currentStationKey);
      }

      return interaction.editReply(`Volume set to ${value}%.`);
    }

    if (cmd === "mute") {
      isMuted = true;

      if (currentStationKey) {
        await playStation(currentStationKey);
      }

      return interaction.editReply("Radio muted.");
    }

    if (cmd === "unmute") {
      isMuted = false;

      if (currentStationKey) {
        await playStation(currentStationKey);
      }

      return interaction.editReply(`Radio unmuted. Volume is ${Math.round(currentVolume * 100)}%.`);
    }

    if (cmd === "status") {
      const status =
        currentStationKey && connection
          ? `Online and playing **${STATIONS[currentStationKey].name}**`
          : "Online but not playing anything.";

      return interaction.editReply({
        embeds: [
          makeEmbed(
            "CRC RADIO Status",
            `${status}\nVolume: **${Math.round(currentVolume * 100)}%**\nMuted: **${isMuted ? "Yes" : "No"}**`
          ),
        ],
      });
    }
  } catch (error) {
    console.error(error);

    const message =
      error.message === "NO_VOICE_CHANNEL"
        ? "Join a voice channel first."
        : "An error happened. Check Railway logs.";

    if (interaction.deferred || interaction.replied) {
      return interaction.editReply(message);
    }

    return interaction.reply({
      content: message,
      ephemeral: true,
    });
  }
});

client.login(TOKEN);