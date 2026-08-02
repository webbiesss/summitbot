const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// ================================
// Configuration
// ================================

// Replace this with the Discord Role ID
// of the minimum role required to use /qotdresume
const REQUIRED_ROLE_ID = '1528783752199929896';

// Location of QOTD data
const qotdPath = path.join(__dirname, '..', 'data', 'qotd.json');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('qotdresume')
        .setDescription('Resume automatic Question of the Day posting'),

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
            // Check Current QOTD Status
            // ================================

            if (qotdData.enabled === true) {
                return interaction.reply({
                    content: 'Automatic QOTD posting is already active.',
                   
                });
            }

            // ================================
            // Resume Automatic QOTD
            // ================================

            qotdData.enabled = true;

            // Save who resumed the QOTD system
            qotdData.resumedBy = interaction.user.id;

            // Save the time it was resumed
            qotdData.resumedAt = new Date().toISOString();

            // ================================
            // Save Updated QOTD Data
            // ================================

            fs.writeFileSync(
                qotdPath,
                JSON.stringify(qotdData, null, 4)
            );

            // ================================
            // Create Response
            // ================================

            const embed = new EmbedBuilder()
                .setTitle('World Expeditions Events Deparmtent')
                .setDescription(
                    `Automatic QOTD posting has been resumed by ${interaction.user}.\n\n` +
                    `To stop automatic QOTD posting, use **/qotdstop**`
                )
                .setColor(0x2B2D31)
                .setTimestamp();

            // ================================
            // Send Response
            // ================================

            await interaction.reply({
                embeds: [embed]
            });

        } catch (error) {
            console.error('Error resuming QOTD:', error);

            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: 'There was an error while resuming automatic QOTD posting.',
                    
                });
            }
        }
    }
};
