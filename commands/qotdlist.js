const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// ================================
// Configuration
// ================================

// Replace this with the Discord Role ID
// of the minimum role required to use /qotdlist
const REQUIRED_ROLE_ID = '1528783752199929896';

// Location of QOTD data
const qotdPath = path.join(__dirname, '..', 'data', 'qotd.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('qotdlist')
        .setDescription('List the next 10 QOTDs in the queue'),

    async execute(interaction) {

        // ================================
        // Check Required Role
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
        // Make Sure QOTD File Exists
        // ================================

        if (!fs.existsSync(qotdPath)) {
            return interaction.reply({
                content: 'There was an error finding the QOTD data file.',
                
            });
        }

        try {

            // ================================
            // Read QOTD Data
            // ================================

            const qotdData = JSON.parse(
                fs.readFileSync(qotdPath, 'utf8')
            );

            // ================================
            // Make Sure Arrays Exist
            // ================================

            if (!Array.isArray(qotdData.queuedQuestions)) {
                qotdData.queuedQuestions = [];
            }

            if (!Array.isArray(qotdData.questions)) {
                qotdData.questions = [];
            }

            // ================================
            // Get Current Automatic QOTD Index
            // ================================

            let currentQuestionIndex = Number.isInteger(
                qotdData.currentQuestionIndex
            )
                ? qotdData.currentQuestionIndex
                : 0;

            // Make sure the index is valid
            if (
                currentQuestionIndex < 0 ||
                currentQuestionIndex >= qotdData.questions.length
            ) {
                currentQuestionIndex = 0;
            }

            // ================================
            // Create Combined QOTD List
            // ================================

            const upcomingQotds = [];

            // ================================
            // Add Manual QOTDs First
            // ================================

            for (
                let i = 0;
                i < qotdData.queuedQuestions.length;
                i++
            ) {
                if (upcomingQotds.length >= 10) break;

                const qotd = qotdData.queuedQuestions[i];

                upcomingQotds.push({
                    type: 'QUEUED',
                    question: qotd.question,
                    addedBy: qotd.addedBy || null
                });
            }

            // ================================
            // Add Automatic QOTDs
            // ================================

            let automaticIndex = currentQuestionIndex;

            while (
                upcomingQotds.length < 10 &&
                qotdData.questions.length > 0
            ) {

                upcomingQotds.push({
                    type: 'AUTOMATIC',
                    question: qotdData.questions[automaticIndex],
                    addedBy: null
                });

                // Move to the next automatic question
                automaticIndex++;

                // Loop back to the beginning
                // when reaching the end of the list
                if (
                    automaticIndex >= qotdData.questions.length
                ) {
                    automaticIndex = 0;
                }

                // Prevent an infinite loop if there are
                // fewer than 10 automatic questions
                if (
                    automaticIndex === currentQuestionIndex
                ) {
                    break;
                }
            }

            // ================================
            // Check if No QOTDs Exist
            // ================================

            if (upcomingQotds.length === 0) {

                const embed = new EmbedBuilder()
                    .setTitle('World Expeditions')
                    .setDescription(
                        'There are currently no QOTDs available in the queue or automatic QOTD list.'
                    )
                    .setColor(0x2B2D31)
                    .setTimestamp();

                return interaction.reply({
                    embeds: [embed],
                   
                });
            }

            // ================================
            // Build QOTD List
            // ================================

            let qotdList = '';

            upcomingQotds.forEach((qotd, index) => {

                // Manual QOTD
                if (qotd.type === 'QUEUED') {

                    const addedBy = qotd.addedBy
                        ? `<@${qotd.addedBy}>`
                        : 'Unknown User';

                    qotdList +=
                        `**#${index + 1} — QUEUED**\n` +
                        `> ${qotd.question}\n` +
                        `> Added by: ${addedBy}\n\n`;
                }

                // Automatic QOTD
                else {

                    qotdList +=
                        `**#${index + 1} — AUTOMATIC**\n` +
                        `> ${qotd.question}\n\n`;
                }
            });

            // ================================
            // Create Response
            // ================================

            const embed = new EmbedBuilder()
                .setTitle('World Expeditions Events Department')
                .setDescription(qotdList)
                .setColor(0x2B2D31)
                .setFooter({
                    text:
                        `Showing ${upcomingQotds.length} upcoming QOTDs | ` +
                        `${qotdData.queuedQuestions.length} manually queued`
                })
                .setTimestamp();

            // ================================
            // Send Response
            // ================================

            await interaction.reply({
                embeds: [embed],
               
            });

        } catch (error) {

            console.error('Error listing QOTDs:', error);

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: 'There was an error while retrieving the QOTD list.',
                 
                });
            }
        }
    }
};