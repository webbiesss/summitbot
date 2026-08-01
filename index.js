const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds
    ]
});

client.commands = new Collection();

// ================================
// Rate Limiter Settings
// ================================

// 3-second cooldown between commands per user
const COOLDOWN_TIME = 3000;

// Stores users currently on cooldown
const cooldowns = new Collection();

// ================================
// Load Commands
// ================================

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    client.commands.set(command.data.name, command);
}

// ================================
// Bot Ready
// ================================

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
});

// ================================
// Handle Commands
// ================================

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) return;

    // ================================
    // Rate Limiter
    // ================================

    const userId = interaction.user.id;
    const now = Date.now();

    // Check if the user is currently on cooldown
    if (cooldowns.has(userId)) {
        const expirationTime = cooldowns.get(userId);

        if (now < expirationTime) {
            const remaining = ((expirationTime - now) / 1000).toFixed(1);

            return interaction.reply({
                content: `⏳ Please wait **${remaining} seconds** before using another command.`,
                ephemeral: true
            });
        }

        // Cooldown has expired
        cooldowns.delete(userId);
    }

    // Set cooldown for this user
    cooldowns.set(userId, now + COOLDOWN_TIME);

    // ================================
    // Execute Command
    // ================================

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);

        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({
                content: 'There was an error executing this command.',
                ephemeral: true
            });
        } else {
            await interaction.reply({
                content: 'There was an error executing this command.',
                ephemeral: true
            });
        }
    }
});

// ================================
// Login
// ================================

client.login(process.env.TOKEN);
