const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

const fs = require('fs');
const path = require('path');

// ================================
// Configuration
// ================================

// Required role ID for QOTD management
const REQUIRED_ROLE_ID =
    '1528783752199929896';

// Location of QOTD data
const qotdPath = path.join(
    __dirname,
    '..',
    'data',
    'qotd.json'
);

// ================================
// Command
// ================================

module.exports = {

    data:
        new SlashCommandBuilder()
            .setName('qotdremove')
            .setDescription(
                'Remove a manually queued QOTD.'
            )

            .addIntegerOption(
                option =>
                    option
                        .setName('number')
                        .setDescription(
                            'The position of the QOTD in the queue to remove.'
                        )
                        .setRequired(true)
                        .setMinValue(1)
            ),

    async execute(interaction) {

        // ================================
        // Check Permissions
        // ================================

        const member =
            interaction.member;

        // Server owner always has permission
        const isOwner =
            interaction.guild.ownerId ===
            interaction.user.id;

        // Get required role
        const requiredRole =
            interaction.guild.roles.cache.get(
                REQUIRED_ROLE_ID
            );

        // Make sure the required role exists
        if (!requiredRole) {

            console.error(
                `Could not find required QOTD role: ${REQUIRED_ROLE_ID}`
            );

            return interaction.reply({
                content:
                    'There was an error checking your permissions.',
                
            });
        }

        // Check if user's highest role is
        // equal to or higher than required role
        const hasPermission =
            member.roles.highest.position >=
            requiredRole.position;

        if (
            !isOwner &&
            !hasPermission
        ) {

            return interaction.reply({
                content:
                    'World Expeditions\nYou do not have permission to run that command.',
                ephemeral: true
            });
        }

        // ================================
        // Get Queue Position
        // ================================

        const queuePosition =
            interaction.options.getInteger(
                'number'
            );

        // ================================
        // Load QOTD Data
        // ================================

        let qotdData;

        try {

            if (
                !fs.existsSync(qotdPath)
            ) {

                return interaction.reply({
                    content:
                        'The QOTD data file could not be found.',
                   
                });
            }

            qotdData =
                JSON.parse(
                    fs.readFileSync(
                        qotdPath,
                        'utf8'
                    )
                );

        } catch (error) {

            console.error(
                'Error loading QOTD data:',
                error
            );

            return interaction.reply({
                content:
                    'There was an error loading the QOTD queue.',
            
            });
        }

        // ================================
        // Check Queue
        // ================================

        if (
            !Array.isArray(
                qotdData.queuedQuestions
            ) ||
            qotdData.queuedQuestions.length === 0
        ) {

            return interaction.reply({
                content:
                    'There are currently no manually queued QOTDs to remove.',
             
            });
        }

        // ================================
        // Check Position
        // ================================

        if (
            queuePosition >
            qotdData.queuedQuestions.length
        ) {

            return interaction.reply({
                content:
                    `There are only **${qotdData.queuedQuestions.length}** QOTD(s) currently in the manual queue.`,
              
            });
        }

        // ================================
        // Remove QOTD
        // ================================

        // Convert queue position to array index
        const queueIndex =
            queuePosition - 1;

        // Get the QOTD before removing it
        const removedQotd =
            qotdData.queuedQuestions[
                queueIndex
            ];

        // Remove the QOTD
        qotdData.queuedQuestions.splice(
            queueIndex,
            1
        );

        // ================================
        // Save Updated Data
        // ================================

        try {

            fs.writeFileSync(
                qotdPath,
                JSON.stringify(
                    qotdData,
                    null,
                    4
                )
            );

        } catch (error) {

            console.error(
                'Error saving QOTD data:',
                error
            );

            return interaction.reply({
                content:
                    'There was an error saving the updated QOTD queue.',
                
            });
        }

        // ================================
        // Get Removed Question
        // ================================

        const removedQuestion =
            removedQotd.question;

        // ================================
        // Create Response Embed
        // ================================

        const embed =
            new EmbedBuilder()

                .setTitle(
                    'World Expeditions Events Department'
                )

                .setDescription(
                    `**Question of the day removed**\nThe following QOTD has been removed from the queue:\n\n**"${removedQuestion}"**`
                )

                .addFields(
                    {
                        name:
                            'Queue Position',

                        value:
                            `#${queuePosition}`,

                        inline:
                            true
                    },

                    {
                        name:
                            'Removed By',

                        value:
                            `${interaction.user}`,

                        inline:
                            true
                    }
                )

                .setColor(
                    0x2B2D31
                )

                .setTimestamp();

        // ================================
        // Send Response
        // ================================

        await interaction.reply({
            embeds:
                [embed]
        });
    }
};