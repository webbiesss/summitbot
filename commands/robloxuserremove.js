const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const { getRoleId } = require('../utils/config');

const REQUIRED_ROLE_ID = getRoleId('guide');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('robloxuserremove')
        .setDescription('Remove a Roblox user from the Roblox climber database.')
        .addStringOption(option =>
            option
                .setName('username')
                .setDescription('Roblox username')
                .setRequired(true)
        ),

    async execute(interaction) {

        // ==========================================
        // PERMISSION CHECK
        // ==========================================

        const commandUser = interaction.member;
        const requiredRole = interaction.guild.roles.cache.get(REQUIRED_ROLE_ID);

        if (!requiredRole) {
            console.error('Required role not found.');
            return interaction.reply({
                content: 'There is a configuration error with this command.',
                ephemeral: true
            });
        }

       const hasPermission = commandUser.roles.cache.has(REQUIRED_ROLE_ID)
            || (commandUser.roles.highest && commandUser.roles.highest.position >= requiredRole.position);

        if (!hasPermission) {
            const permissionEmbed = new EmbedBuilder()
                .setTitle('World Expeditions')
                .setDescription('you do not have permission to run that command')
                .setColor(0xFF0000);

            return interaction.reply({
                embeds: [permissionEmbed],
                ephemeral: true
            });
        }

        // Get the username from the command options
        const username = interaction.options
            .getString('username')
            .trim();
        
        // Load the database
        const dbPath = path.join(__dirname, '..', 'data', 'robloxusers.json');
        let users = [];
        if (fs.existsSync(dbPath)) {
            const data = fs.readFileSync(dbPath, 'utf8');
            users = JSON.parse(data);
        }

        // Find the user in the database
        const userIndex = users.findIndex(user => user.username.toLowerCase() === username.toLowerCase());

        if (userIndex === -1) {
            const embed = new EmbedBuilder()
                .setTitle('World Expeditions Guide Department')
                .setDescription(
                    `❌ Roblox user **${username}** was not found in the climber database.\n\n` +
                    `Use **/robloxstamplist** to view all registered Roblox climbers.`
                )
                .setColor(0xFF0000);
            return interaction.reply({
                embeds: [embed]
            });
        }

        // Remove the user from the database
        users.splice(userIndex, 1);

        // Save the updated database
        fs.writeFileSync(dbPath, JSON.stringify(users, null, 2));

        // Send confirmation message
        const confirmationEmbed = new EmbedBuilder()
            .setTitle('World Expeditions Guide Department')
            .setDescription(`✅ Roblox user **${username}** has been removed from the climber database.🗑️`)
            .setColor(0x00FF00);
        await interaction.reply({
            embeds: [confirmationEmbed]
        });
    }
};