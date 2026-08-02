const fs = require('fs');
const path = require('path');
const {
    REST,
    Routes
} = require('discord.js');

require('dotenv').config();

// ================================
// Command Collection
// ================================

const commands = [];

// ================================
// Commands Folder
// ================================

const commandsPath = path.join(
    __dirname,
    'commands'
);

// Get all JavaScript command files
const commandFiles = fs
    .readdirSync(commandsPath)
    .filter(
        file => file.endsWith('.js')
    );

// ================================
// Load Commands
// ================================

for (const file of commandFiles) {

    const filePath = path.join(
        commandsPath,
        file
    );

    try {

        const command = require(
            filePath
        );

        // Make sure the command has
        // the required data property
        if (
            command.data &&
            command.data.toJSON
        ) {

            commands.push(
                command.data.toJSON()
            );

            console.log(
                `Preparing command: /${command.data.name}`
            );

        } else {

            console.warn(
                `Skipping ${file}: Missing command.data`
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
// Discord REST API
// ================================

const rest = new REST({
    version: '10'
}).setToken(
    process.env.TOKEN
);

// ================================
// Deploy Commands
// ================================

(async () => {

    try {

        console.log('');
        console.log(
            `Started refreshing ${commands.length} application (/) commands.`
        );

        await rest.put(

            Routes.applicationGuildCommands(
                process.env.CLIENT_ID,
                process.env.GUILD_ID
            ),

            {
                body: commands
            }

        );

        console.log('');
        console.log(
            'Successfully reloaded application (/) commands.'
        );

        console.log('');
        console.log(
            'Registered commands:'
        );

        for (
            const command of commands
        ) {

            console.log(
                `- /${command.name}`
            );
        }

        console.log('');

    } catch (error) {

        console.error(
            'Error deploying commands:',
            error
        );

    }

})();
