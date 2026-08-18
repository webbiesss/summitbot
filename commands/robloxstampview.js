const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const { getRoleId } = require('../utils/config');

const REQUIRED_ROLE_ID = getRoleId('guide');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('robloxstampview')
        .setDescription('View a Roblox climber\'s summit stamps.')
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
        // FIND USER
        // ==========================================

        const user = users.find(
            u => u.username.toLowerCase() === username.toLowerCase()
        );

        if (!user) {

            const embed = new EmbedBuilder()
                .setTitle('World Expeditions Guide Department')
                .setDescription(
                    `❌ Roblox user **${username}** was not found.\n\n` +
                    `Use **/robloxstamplist** to view all registered Roblox climbers.\n\n` +
                    `If the climber is not listed, add them to the database using **/robloxuseradd**.`
                )
                .setColor(0xFF0000);

            return interaction.reply({
                embeds: [embed],
                ephemeral: true
            });

        }

        // ==========================================
        // CREATE RESPONSE
        // ==========================================
        const formatStampCount = (count) => {
            const stampWord = count === 1 ? 'stamp' : 'stamps';
            return `They have ${count} summit ${stampWord} 🏔️`;
        };

        const embed = new EmbedBuilder()
            .setTitle('World Expeditions Roblox Climber Profile')
            .setColor(0x00AEFF)
            .addFields(
                {
                    name: 'Username',
                    value: user.username,
                    inline: true
                },
                {
                    name: 'Summit Stamps',
                    value: formatStampCount(user.summits),
                    inline: true
                }
            )
            .setFooter({
                text: `Viewed by ${interaction.user.username} • ${new Date().toISOString()}`
            });

        await interaction.reply({
            embeds: [embed]
        });

    }
};