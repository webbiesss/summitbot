const fs = require('fs');
const path = require('path');
const {
    Client,
    Collection,
    GatewayIntentBits
} = require('discord.js');
const cron = require('node-cron');

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


// Nightly backup of data folder at 3:00 AM server time
cron.schedule('0 3 * * *', () => {
try {
const timestamp = new Date()
.toISOString()
.replace(/[:.]/g, '-');
 
const backupDir = path.join(__dirname, 'backups');

if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
}
 
const sourceDir = path.join(__dirname, 'data');
 
const backupFile = path.join(
backupDir,
`backup-${timestamp}.json`
);
 
const files = fs.readdirSync(sourceDir);
 
const backupData = {};
 
for (const file of files) {
const filePath = path.join(sourceDir, file);
 
if (file.endsWith('.json')) {
backupData[file] = JSON.parse(
fs.readFileSync(filePath, 'utf8')
);
}
}
 
fs.writeFileSync(
backupFile,
JSON.stringify(backupData, null, 2)
);
// Keep only the 14 most recent backups
const backups = fs
.readdirSync(backupDir)
.filter(f => f.endsWith('.json'))
.sort();
 
while (backups.length > 14) {
fs.unlinkSync(
path.join(backupDir, backups.shift())
);
}
 
console.log(
`[BACKUP] Completed ${backupFile}`
);
} catch (err) {
console.error('[BACKUP ERROR]', err);
}
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
// Cooldown Cleanup
// ================================

// Clean up expired cooldowns every minute to prevent memory leaks
setInterval(() => {
    const now = Date.now();
    for (const [userId, expirationTime] of cooldowns.entries()) {
        if (now >= expirationTime) {
            cooldowns.delete(userId);
        }
    }
}, 60000);

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
    'ready',
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

// Health check every 5 minutes
setInterval(async () => {
    try {
        if (typeof fetch !== 'function') {
            console.warn('[HEALTH CHECK] fetch is unavailable in this Node.js runtime.');
            return;
        }

        const response = await fetch(
            'https://api.github.com/repos/webbiesss/summitbot'
        );

        console.log(
            `[HEALTH CHECK] Status: ${response.status} (${response.ok ? 'OK' : 'ERROR'})`
        );
    } catch (err) {
        console.error('[HEALTH CHECK ERROR]', err);
    }
}, 5 * 60 * 1000);