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

        if (
            !interaction.member.roles.cache.has(
                REQUIRED_ROLE_ID
            )
        ) {

            return interaction.reply({

                content:
                    'You do not have permission to use this command.',

                ephemeral:
                    true
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
