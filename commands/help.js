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
        'View a list of World Expedition Manager commands that you have permission to use.'
};

// ================================
// Check Role Hierarchy
// ================================

function hasRequiredRole(
    member,
    requiredRoleId
) {

    // Make sure the member exists
    if (!member) {
        return false;
    }

    // Server owner always has access
    if (
        member.guild.ownerId ===
        member.id
    ) {

        return true;
    }

    // Get the required role
    const requiredRole =
        member.guild.roles.cache.get(
            requiredRoleId
        );

    // Required role does not exist
    if (!requiredRole) {

        console.warn(
            `Required role ${requiredRoleId} could not be found.`
        );

        return false;
    }

    // Check if the user's highest role
    // is equal to or higher than the
    // required role
    return (
        member.roles.highest.position >=
        requiredRole.position
    );
}

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

        const member =
            interaction.member;

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
                        '/addqotd',

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

        let commandList = '';

        for (
            const command
            of availableCommands
        ) {

            commandList +=
                `**${command.name}**\n` +
                `${command.description}\n\n`;
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
                    {
                        name:
                            'Available Commands',

                        value:
                            commandList ||
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