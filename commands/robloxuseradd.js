const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const { getRoleId } = require('../utils/config');

const REQUIRED_ROLE_ID = getRoleId('guide');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('robloxuseradd')
        .setDescription('Add a Roblox user to the Roblox climber database.')
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
                content: 'There is a configuration error with this command.'
            });
        }

        const hasPermission = commandUser.roles.cache.some(
            role => role.position >= requiredRole.position
        );

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

        // ==========================================
        // GET USERNAME
        // ==========================================

        const username = interaction.options
            .getString('username')
            .trim();

        // ==========================================
        // LOAD DATABASE
        // ==========================================

        const dbPath = path.join(__dirname, '..', 'data', 'robloxusers.json');

        let users = [];

        if (fs.existsSync(dbPath)) {
            users = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        }

        // ==========================================
        // CHECK FOR DUPLICATES
        // ==========================================

        const existingUser = users.find(
            user => user.username.toLowerCase() === username.toLowerCase()
        );

        if (existingUser) {

            const embed = new EmbedBuilder()
                .setTitle('World Expeditions Guide Department')
                .setDescription(
                    `❌ Roblox user **${existingUser.username}** already exists in the climber database.` +
                    `\n\nUse **/robloxstamplist** to view all registered Roblox climbers.` +
                    `\n\nIf you need to update their summit stamps, use **/robloxstampupdate**.`
                )
                .setColor(0xFF0000);

            return interaction.reply({
                embeds: [embed],
                ephemeral: true
            });

        }

        // ==========================================
        // ADD USER
        // ==========================================

        users.push({
            username: username,
            summits: 0
        });

        // Sort alphabetically
        users.sort((a, b) =>
            a.username.localeCompare(b.username)
        );

        // ==========================================
        // SAVE DATABASE
        // ==========================================

        fs.writeFileSync(
            dbPath,
            JSON.stringify(users, null, 2)
        );

        // ==========================================
        // RESPONSE
        // ==========================================

        const embed = new EmbedBuilder()
            .setTitle('World Expeditions Guide Department')
            .setDescription(
                `✅ Successfully added **${username}** to the Roblox climber database.\n\n` +
                `Current Summit Stamps: **0 🏔️**`
            )
            .setColor(0x00AEFF)
            .setFooter({
                text: `Added by ${interaction.user.username} • ${new Date().toISOString()}`
            });

        await interaction.reply({
            embeds: [embed]
        });

    }
};