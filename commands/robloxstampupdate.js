const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('robloxstampupdate')
        .setDescription('Update a Roblox climber’s summit stamps')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('Roblox username')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Number of summit stamps to add')
                .setRequired(true)),

    async execute(interaction) {

        // ==========================================
        // REQUIRED ROLE
        // ==========================================
        const { getRoleId } = require('../utils/config');

        const requiredRoleId = getRoleId('guide');

        const commandUser = interaction.member;
        const requiredRole = interaction.guild.roles.cache.get(requiredRoleId);

        if (!requiredRole) {
            console.error('The required role for /robloxstampupdate could not be found.');

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
        // GET INPUT
        // ==========================================

        const username = interaction.options.getString('username').trim();
        const amount = interaction.options.getInteger('amount');

        // ==========================================
        // LOAD DATABASE
        // ==========================================

        const dbPath = path.join(__dirname, '..', 'data', 'robloxusers.json');

        let db = [];

        if (fs.existsSync(dbPath)) {
            db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        }

        // ==========================================
        // FIND USER (CASE INSENSITIVE)
        // ==========================================

        const user = db.find(
            u => u.username.toLowerCase() === username.toLowerCase()
        );

        if (!user) {
            const embed = new EmbedBuilder()
                .setTitle('World Expeditions Guide Department')
                .setDescription(
                    `❌ Roblox user **${username}** was not found. ❌\n\n` +
                    `Use **/robloxstamplist** to view all registered Roblox climbers.\n\n` +
                    `If the climber is not listed, add them to the database using **/robloxuseradd**.`
                )
                .setColor(0xFF0000);

            return interaction.reply({
                embeds: [embed],
                ephemeral: false
            });
        }

        // ==========================================
        // UPDATE SUMMITS
        // ==========================================

        const initialTotal = user.summits;

        user.summits += amount;

        const total = user.summits;

        // Prevent negative totals
        if (user.summits < 0) {
            user.summits = 0;
        }

        // ==========================================
        // SAVE DATABASE
        // ==========================================

        fs.writeFileSync(
            dbPath,
            JSON.stringify(db, null, 2)
        );

        // ==========================================
        // RESPONSE
        // ==========================================

        const embed = new EmbedBuilder()
            .setTitle('World Expeditions Guide Department')
            .setDescription(
                `Updated **${user.username}**'s summit stamps by **${amount}**.\n\n` +
                `**${initialTotal} ➜ ${user.summits} 🏔️**`
            )
            .setColor(0x00AEFF)
            .setFooter({
                text: `Logged by ${interaction.user.username} • ${new Date().toISOString()}`
            });

        await interaction.reply({
            embeds: [embed]
        });
    }
};