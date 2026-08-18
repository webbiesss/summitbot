const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const fs = require('fs');
const path = require('path');

const USERS_PER_PAGE = 10;
const REQUIRED_ROLE_ID = '827956660638318592';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('robloxstamplist')
        .setDescription('View the Roblox climber summit database of climbers not found in the discord server.'),

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
            const embed = new EmbedBuilder()
                .setTitle('World Expeditions')
                .setDescription('you do not have permission to run that command')
                .setColor(0xFF0000);

            return interaction.reply({
                embeds: [embed],
                ephemeral: true
            });
        }

        // ==========================================
        // LOAD DATABASE
        // ==========================================

        const dbPath = path.join(__dirname, '..', 'data', 'robloxusers.json');

        let users = [];

        if (fs.existsSync(dbPath)) {
            users = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        }

        if (!users.length) {
            const embed = new EmbedBuilder()
                .setTitle('World Expeditions Guide Department')
                .setDescription('There are currently no Roblox climbers in the database.')
                .setColor(0xFF0000);

            return interaction.reply({ embeds: [embed] });
        }

        // Alphabetical sorting
        users.sort((a, b) =>
            a.username.localeCompare(b.username)
        );

        const totalPages = Math.ceil(users.length / USERS_PER_PAGE);

        // ==========================================
        // EMBED FUNCTION
        // ==========================================

        const createEmbed = (page) => {

            const start = page * USERS_PER_PAGE;
            const end = start + USERS_PER_PAGE;

            const pageUsers = users.slice(start, end);

            const description = pageUsers
                .map((user, index) => {

                    const number = start + index + 1;

                    return `**${number}.** ${user.username} — **${user.summits}** 🏔️`;

                })
                .join('\n');

            return new EmbedBuilder()
                .setTitle('World Expeditions Roblox Climbers List')
                .setDescription(description)
                .setColor(0x00AEFF)
                .setFooter({
                    text: `Page ${page + 1} of ${totalPages}`
                });
        };

        // ==========================================
        // BUTTONS
        // ==========================================

        const createButtons = (page) => {

            return new ActionRowBuilder().addComponents(

                new ButtonBuilder()
                    .setCustomId('previous')
                    .setLabel('⬅ Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page === 0),

                new ButtonBuilder()
                    .setCustomId('next')
                    .setLabel('Next ➜')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page >= totalPages - 1)

            );

        };

        // ==========================================
        // SEND FIRST PAGE
        // ==========================================

        let currentPage = 0;

        const message = await interaction.reply({
            embeds: [createEmbed(currentPage)],
            components: [createButtons(currentPage)],
            fetchReply: true
        });

        // ==========================================
        // COLLECTOR
        // ==========================================

        const collector = message.createMessageComponentCollector({
            time: 300000 // 5 minutes
        });

        collector.on('collect', async i => {

            // Only command user may interact

            if (i.user.id !== interaction.user.id) {

                return i.reply({
                    content: 'Only the user who ran this command can use these buttons.',
                    ephemeral: true
                });

            }

            if (i.customId === 'next') {

                currentPage++;

            } else if (i.customId === 'previous') {

                currentPage--;

            }

            await i.update({
                embeds: [createEmbed(currentPage)],
                components: [createButtons(currentPage)]
            });

        });

        // ==========================================
        // DISABLE BUTTONS AFTER TIMEOUT
        // ==========================================

        collector.on('end', async () => {

            try {

                await interaction.editReply({
                    embeds: [createEmbed(currentPage)],
                    components: []
                });

            } catch (err) {
                // Message was likely deleted.
            }

        });

    }
};