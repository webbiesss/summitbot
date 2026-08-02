const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// ================================
// Configuration
// ================================

// Replace this with the Discord Role ID
// of the minimum role required to use /addqotd
const REQUIRED_ROLE_ID = '1528783752199929896';

// Location of QOTD data
const qotdPath = path.join(__dirname, '..', 'data', 'qotd.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('qotdadd')
        .setDescription('Queue a Question of the Day')
        .addStringOption(option =>
            option
                .setName('question')
                .setDescription('The question you want to queue for the next QOTD')
                .setRequired(true)
                .setMaxLength(1000)
        ),

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
        // Get QOTD
        // ================================

        const question = interaction.options.getString('question');

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

            // Make sure queuedQuestions exists
            if (!Array.isArray(qotdData.queuedQuestions)) {
                qotdData.queuedQuestions = [];
            }

            // ================================
            // Determine Queue Position
            // ================================

            // The new question will be added to the end
            // of the queue, so its position is the current
            // queue length + 1
            const queuePosition = qotdData.queuedQuestions.length + 1;

            // ================================
            // Add Question to Queue
            // ================================

            qotdData.queuedQuestions.push({
                question: question,
                addedBy: interaction.user.id,
                addedAt: new Date().toISOString()
            });

            // ================================
            // Save Updated QOTD Data
            // ================================

            fs.writeFileSync(
                qotdPath,
                JSON.stringify(qotdData, null, 4)
            );

            // ================================
            // Create Timestamp
            // ================================

            const timestamp = Math.floor(Date.now() / 1000);

            // ================================
            // Create Response
            // ================================

            const embed = new EmbedBuilder()
                .setTitle('World Expeditions Events Department')
                .setDescription(
                    `Your QOTD\n` +
                    `"${question}"\n` +
                    `is **#${queuePosition}** in the queue, and will be produced for the next QOTD.\n\n` +
                    `Use **/qotdremove** to remove your QOTD.`
                )
                .setColor(0x2B2D31)
                .setTimestamp();

            // ================================
            // Send Response
            // ================================

            await interaction.reply({
                embeds: [embed],
               
            });

        } catch (error) {
            console.error('Error adding QOTD:', error);

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: 'There was an error while adding your QOTD.',
                    ephemeral: true
                });
            }
        }
    }
};
