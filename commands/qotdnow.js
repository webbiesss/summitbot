const {
    SlashCommandBuilder,
    EmbedBuilder
} = require('discord.js');

const {
    forcePostQotd
} = require('../features/qotd');

module.exports = {

    data:
        new SlashCommandBuilder()

            .setName(
                'qotdnow'
            )

            .setDescription(
                'Immediately post the next QOTD.'
            ),

    async execute(
        interaction
    ) {

        // ================================
        // Required Role
        // ================================

        const REQUIRED_ROLE_ID =
            '1528783752199929896';

        // ================================
        // Check User Permissions
        // ================================

        const member = interaction.member;
        const requiredRole = interaction.guild.roles.cache.get(REQUIRED_ROLE_ID);

       // Check if the required role exists
        if (!requiredRole) {
            console.error(
                `QOTD required role with ID ${REQUIRED_ROLE_ID} was not found.`
            );

            return interaction.reply({
                content: 'There was an error checking your permissions.',
              
            });
        }

        // Check if the user has the required role or higher
        if (member.roles.highest.position < requiredRole.position) {
            return interaction.reply({
                content: 'World Expeditions\nYou do not have permission to run that command.',
                ephemeral: true
            });
        }

        // ================================
        // Force QOTD
        // ================================

        const result =
            await forcePostQotd(
                interaction.client
            );

        // ================================
        // Handle Error
        // ================================

        if (
            !result.success
        ) {

            return interaction.reply({

                content:
                    `❌ ${result.message}`,

                ephemeral:
                    true
            });
        }

        // ================================
        // Success Message
        // ================================

        const timestamp =
            Math.floor(
                Date.now() / 1000
            );

        const embed =
            new EmbedBuilder()

                .setTitle(
                    '🏔️ QOTD Posted'
                )

                .setDescription(
                    `The following QOTD has been posted:\n\n**${result.question}**`
                )

                .setColor(
                    0x2B2D31
                )

                .setTimestamp();

        return interaction.reply({

            embeds: [
                embed
            ]
        });
    }
};
