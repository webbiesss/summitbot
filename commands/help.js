const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

// ================================
// Required Role IDs
// ================================

// QOTD commands and other general commands
// require this role or higher
const QOTD_REQUIRED_ROLE_ID =
    '1528783752199929896';

// /stampupdate requires this role or higher
const STAMPUPDATE_REQUIRED_ROLE_ID =
    '827956660638318592';

// ================================
// Command Descriptions
// ================================

const commandDescriptions = {

    addqotd:
        'Add a new Question of the Day to the QOTD queue.',

    qotdlist:
        'View the next 10 Questions of the Day currently in the queue.',

    qotdstop:
        'Pause automatic Question of the Day posting.',

    qotdresume:
        'Resume automatic Question of the Day posting.',

    stampupdate:
        'Update a climber\'s summit stamp total.',

    profile:
        'View your climber profile or another climber\'s profile,\nincluding level and number of summit stamps',


    leaderboard:
        'View the leaderboard showing climbers ranked by summit stamps.',

    help:
        'View a list of World Expedition Manager commands that you have permission to use.',
    robloxstamplist:
        'List Roblox stamp entries currently stored in the system.',

    robloxstampupdate:
        'Update a Roblox user\'s stamp total.',

    robloxstampview:
        'View a Roblox user\'s stamp total and related info.',

    robloxuseradd:
        'Add a Roblox user to the tracking system.',

    robloxuserremove:
        'Remove a Roblox user from the tracking system.',

    transferrobloxuser:
        'Transfer a Roblox user (and their stamps) to another account.'    
};

// ================================
// Check Role Hierarchy
// ================================

// ...existing code...

function hasRequiredRole(
    member,
    requiredRoleId
) {

    // Make sure the member and guild exist
    if (!member || !member.guild) {
        return false;
    }

    // Server owner always has access
    if (member.guild.ownerId === member.id) {
        return true;
    }

    // Get the required role from the guild
    const requiredRole =
        member.guild.roles?.cache.get(requiredRoleId);

    if (!requiredRole) {
        console.warn(
            `Required role ${requiredRoleId} could not be found.`
        );
        return false;
    }

    // If roles info isn't available on the member, deny access
    if (!member.roles || !member.roles.highest) {
        return false;
    }

    // Compare highest role positions
    return (
        member.roles.highest.position >=
        requiredRole.position
    );
}

// ...existing code...

// ================================
// Command
// ================================

module.exports = {

    data:
        new SlashCommandBuilder()
            .setName('help')
            .setDescription(
                'View commands that you have permission to use.'
            ),

    async execute(interaction) {

        // ================================
        // Get Guild Member
        // ================================

         let member = interaction.member;

        // interaction.member can be partial for interactions (no roles manager).
        // Fetch the full GuildMember if needed so role checks work reliably.
        if (interaction.guild && (!member || !member.roles || !member.roles.highest)) {
            try {
                member = await interaction.guild.members.fetch(interaction.user.id);
            } catch (err) {
                console.error('Failed to fetch guild member for help command:', err);
                member = interaction.member; // fall back to whatever we have
            }
        }
        // ================================
        // Create Command List
        // ================================

        const availableCommands = [];

        // ================================
        // QOTD Commands
        // ================================

        if (
            hasRequiredRole(
                member,
                QOTD_REQUIRED_ROLE_ID
            )
        ) {

            availableCommands.push(
                {
                    name:
                        '/qotdadd',

                    description:
                        commandDescriptions.addqotd
                }
            );

            availableCommands.push(
                {
                    name:
                        '/qotdlist',

                    description:
                        commandDescriptions.qotdlist
                }
            );

            availableCommands.push(
                {
                    name:
                        '/qotdstop',

                    description:
                        commandDescriptions.qotdstop
                }
            );

            availableCommands.push(
                {
                    name:
                        '/qotdresume',

                    description:
                        commandDescriptions.qotdresume
                }
            );

             availableCommands.push(
                {
                    name:
                        '/qotdnow',

                    description:
                        'Forces the QOTD to be posted.'
                }
            );

            availableCommands.push({
                 name: '/qotdremove',
                description: 'Remove a manually queued QOTD from the queue.'
            });
        }

        // ================================
        // Stamp Update Command
        // ================================

        if (
            hasRequiredRole(
                member,
                STAMPUPDATE_REQUIRED_ROLE_ID
            )
        ) {

            availableCommands.push(
                {
                    name:
                        '/stampupdate',

                    description:
                        commandDescriptions.stampupdate
                }
            );
            // Roblox-related commands (require STAMPUPDATE role)
            availableCommands.push({
                name: '/robloxstamplist',
                description: commandDescriptions.robloxstamplist
            });

            availableCommands.push({
                name: '/robloxstampupdate',
                description: commandDescriptions.robloxstampupdate
            });

            availableCommands.push({
                name: '/robloxstampview',
                description: commandDescriptions.robloxstampview
            });

            availableCommands.push({
                name: '/robloxuseradd',
                description: commandDescriptions.robloxuseradd
            });

            availableCommands.push({
                name: '/robloxuserremove',
                description: commandDescriptions.robloxuserremove
            });

            availableCommands.push({
                name: '/transferrobloxuser',
                description: commandDescriptions.transferrobloxuser
            });
        }

        // ================================
        // Leaderboard
        // ================================

        // Everyone can use leaderboard
        availableCommands.push(
            {
                name:
                    '/leaderboard',

                description:
                    commandDescriptions.leaderboard
            }
        );
          availableCommands.push(
            {
                name:
                    '/profile',

                description:
                    commandDescriptions.profile
            }
        );

        // ================================
        // Help Command
        // ================================

        // Everyone can use help
        availableCommands.push(
            {
                name:
                    '/help',

                description:
                    commandDescriptions.help
            }
        );

        // ================================
        // Build Command List
        // ================================

        const commandFields = [];
        let commandList = '';

        for (
            const command
            of availableCommands
        ) {

            const commandText =
                `**${command.name}**\n` +
                `${command.description}\n\n`;

            if (
                commandList &&
                commandList.length + commandText.length > 1024
            ) {
                commandFields.push({
                    name:
                        commandFields.length === 0
                            ? 'Available Commands'
                            : 'Available Commands (continued)',
                    value:
                        commandList
                });
                commandList = '';
            }

            commandList += commandText;
        }

        if (commandList) {
            commandFields.push({
                name:
                    commandFields.length === 0
                        ? 'Available Commands'
                        : 'Available Commands (continued)',
                value:
                    commandList
            });
        }

        // ================================
        // Create Embed
        // ================================

        const embed =
            new EmbedBuilder()

                .setTitle(
                    'World Expeditions Manager Help'
                )

                .setDescription(
                    'Here are the commands you currently have permission to use:'
                )

                .addFields(
                    commandFields.length > 0
                        ? commandFields
                        : {
                            name:
                                'Available Commands',
                            value:
                                'You currently do not have access to any commands.'
                        }
                )

                .setColor(
                    0x2B2D31
                )

                .setTimestamp();

        // ================================
        // Send Response
        // ================================

        await interaction.reply(
            {
                embeds:
                    [embed],

                ephemeral:
                    true
            }
        );
    }
};