const fs = require('fs');
const path = require('path');
const {
    Client,
    Collection,
    GatewayIntentBits
} = require('discord.js');

require('dotenv').config();

// Import QOTD scheduler
const {
    startQotdScheduler
} = require('./features/qotd');

// ================================
// Create Discord Client
// ================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds
    ]
});

// ================================
// Command Collection
// ================================

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

const commandsPath = path.join(
    __dirname,
    'commands'
);

const commandFiles = fs
    .readdirSync(commandsPath)
    .filter(
        file => file.endsWith('.js')
    );

for (const file of commandFiles) {

    const filePath = path.join(
        commandsPath,
        file
    );

    try {

        const command = require(filePath);

        // Make sure the command has
        // the required properties
        if (
            command.data &&
            command.execute
        ) {

            client.commands.set(
                command.data.name,
                command
            );

            console.log(
                `Loaded command: /${command.data.name}`
            );

        } else {

            console.warn(
                `Command ${file} is missing "data" or "execute".`
            );
        }

    } catch (error) {

        console.error(
            `Error loading command ${file}:`,
            error
        );
    }
}

// ================================
// Bot Ready
// ================================

client.once(
    'clientReady',
    () => {

        console.log(
            `Logged in as ${client.user.tag}`
        );

        console.log(
            `Loaded ${client.commands.size} commands.`
        );

        // ================================
        // Start QOTD Scheduler
        // ================================

        startQotdScheduler(client);

    }
);

// ================================
// Handle Commands
// ================================

client.on(
    'interactionCreate',
    async interaction => {

        // Only handle slash commands
        if (
            !interaction.isChatInputCommand()
        ) {
            return;
        }

        // Find the command
        const command =
            client.commands.get(
                interaction.commandName
            );

        if (!command) {
            return;
        }

        // ================================
        // Rate Limiter
        // ================================

        const userId =
            interaction.user.id;

        const now = Date.now();

        // Check if the user is currently
        // on cooldown
        if (cooldowns.has(userId)) {

            const expirationTime =
                cooldowns.get(userId);

            if (
                now < expirationTime
            ) {

                const remaining =
                    (
                        (expirationTime - now) /
                        1000
                    ).toFixed(1);

                return interaction.reply({
                    content:
                        `⏳ Please wait **${remaining} seconds** before using another command.`,
                    ephemeral: true
                });
            }

            // Cooldown has expired
            cooldowns.delete(userId);
        }

        // ================================
        // Set User Cooldown
        // ================================

        cooldowns.set(
            userId,
            now + COOLDOWN_TIME
        );

        // ================================
        // Execute Command
        // ================================

        try {

            await command.execute(
                interaction
            );

        } catch (error) {

            console.error(
                `Error executing /${interaction.commandName}:`,
                error
            );

            // ================================
            // Handle Command Error
            // ================================

            try {

                if (
                    interaction.replied ||
                    interaction.deferred
                ) {

                    await interaction.followUp({
                        content:
                            'There was an error executing this command.',
                        ephemeral: true
                    });

                } else {

                    await interaction.reply({
                        content:
                            'There was an error executing this command.',
                        ephemeral: true
                    });

                }

            } catch (replyError) {

                console.error(
                    'Error sending error response:',
                    replyError
                );
            }
        }
    }
);

// ================================
// Login
// ================================

client.login(
    process.env.TOKEN
);