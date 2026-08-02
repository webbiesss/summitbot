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

        const member =
            interaction.member;

        const requiredRole =
            interaction.guild.roles.cache.get(
                REQUIRED_ROLE_ID
            );

        // ================================
        // Check if Required Role Exists
        // ================================

        if (
            !requiredRole
        ) {

            console.error(
                `QOTD required role with ID ${REQUIRED_ROLE_ID} was not found.`
            );

            return interaction.reply({

                content:
                    'There was an error checking your permissions.',

                ephemeral:
                    true
            });
        }

        // ================================
        // Check if User Has Required Role
        // or Higher
        // ================================

        if (
            member.roles.highest.position <
            requiredRole.position
        ) {

            return interaction.reply({

                content:
                    'World Expeditions\nYou do not have permission to run that command.',

                ephemeral:
                    true
            });
        }

        // ================================
        // Force QOTD
        // ================================

        let result;

        try {

            result =
                await forcePostQotd(
                    interaction.client
                );

        } catch (error) {

            console.error(
                'Error while forcing QOTD:',
                error
            );

            return interaction.reply({

                content:
                    '❌ There was an error while trying to post the QOTD.',

                ephemeral:
                    true
            });
        }

        // ================================
        // Handle QOTD Error
        // ================================

        if (
            !result ||
            !result.success
        ) {

            return interaction.reply({

                content:
                    `❌ ${
                        result?.message ||
                        'The QOTD could not be posted.'
                    }`,

                ephemeral:
                    true
            });
        }

        // ================================
        // Success Message
        // ================================

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
