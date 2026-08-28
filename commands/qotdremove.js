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
const { getRoleId } = require('../utils/config');

const REQUIRED_ROLE_ID = getRoleId('staff');
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
                'Remove a queued or automatic QOTD.'
            )

            .addIntegerOption(
                option =>
                    option
                        .setName('number')
                        .setDescription(
                            'The position of the QOTD in the list to remove.'
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

        if (!Array.isArray(qotdData.queuedQuestions)) {
            qotdData.queuedQuestions = [];
        }

        if (!Array.isArray(qotdData.questions)) {
            qotdData.questions = [];
        }

        if (
            qotdData.queuedQuestions.length === 0 &&
            qotdData.questions.length === 0
        ) {

            return interaction.reply({
                content:
                    'There are currently no QOTDs to remove.',
             
            });
        }

        // ================================
        // Check Position
        // ================================

        const totalQotds =
            qotdData.queuedQuestions.length +
            qotdData.questions.length;

        if (queuePosition > totalQotds) {

            return interaction.reply({
                content:
                    `There are only **${totalQotds}** QOTD(s) currently available to remove.`,
              
            });
        }

        // ================================
        // Remove QOTD
        // ================================

        let removedQuestion;
        let removedType;

        if (queuePosition <= qotdData.queuedQuestions.length) {
            const queueIndex = queuePosition - 1;
            const removedQotd = qotdData.queuedQuestions[queueIndex];

            removedQuestion = removedQotd.question;
            removedType = 'queued';

            qotdData.queuedQuestions.splice(queueIndex, 1);
        } else {
            const automaticOffset =
                queuePosition - qotdData.queuedQuestions.length - 1;
            const automaticCount = qotdData.questions.length;
            const currentQuestionIndex = Number.isInteger(
                qotdData.currentQuestionIndex
            ) && qotdData.currentQuestionIndex >= 0 &&
                qotdData.currentQuestionIndex < automaticCount
                ? qotdData.currentQuestionIndex
                : 0;
            const automaticIndex =
                (currentQuestionIndex + automaticOffset) % automaticCount;

            removedQuestion = qotdData.questions[automaticIndex];
            removedType = 'automatic';

            qotdData.questions.splice(automaticIndex, 1);

            if (qotdData.questions.length === 0) {
                qotdData.currentQuestionIndex = 0;
            } else if (automaticIndex < currentQuestionIndex) {
                qotdData.currentQuestionIndex = currentQuestionIndex - 1;
            } else if (currentQuestionIndex >= qotdData.questions.length) {
                qotdData.currentQuestionIndex = 0;
            } else {
                qotdData.currentQuestionIndex = currentQuestionIndex;
            }
        }

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
        // Create Response Embed
        // ================================

        const embed =
            new EmbedBuilder()

                .setTitle(
                    'World Expeditions Events Department'
                )

                .setDescription(
                    `**Question of the day removed**\nThe following ${removedType} QOTD has been removed:\n\n**"${removedQuestion}"**`
                )

                .addFields(
                    {
                        name:
                            'List Position',

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