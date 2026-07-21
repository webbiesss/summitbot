const {
    SlashCommandBuilder,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} = require('discord.js');

const fs = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View the top climbers by summit stamps'),

    async execute(interaction) {
        const dbPath = path.join(__dirname, '..', 'data', 'climbers.json');
        let db = JSON.parse(fs.readFileSync(dbPath));

        // Convert DB into sortable array
        // and sort from highest to lowest summit stamps
        const leaderboard = Object.entries(db)
            .map(([userId, data]) => ({
                userId,
                summits: data.summits || 0
            }))
            .sort((a, b) => b.summits - a.summits);

        // Number of members per page
        const membersPerPage = 10;

        // Calculate total number of pages
        const totalPages = Math.max(
            1,
            Math.ceil(leaderboard.length / membersPerPage)
        );

        // Start on page 1
        let currentPage = 0;

        // Function to create the leaderboard embed
        async function createLeaderboardEmbed(page) {

            // Calculate which members should appear on this page
            const startIndex = page * membersPerPage;
            const pageMembers = leaderboard.slice(
                startIndex,
                startIndex + membersPerPage
            );

            // Build leaderboard text
            let description = '';

            for (let i = 0; i < pageMembers.length; i++) {
                const entry = pageMembers[i];

                const member = await interaction.guild.members
                    .fetch(entry.userId)
                    .catch(() => null);

                const name = member
                    ? member.user.username
                    : `Unknown User (${entry.userId})`;

                // Overall ranking position
                const rank = startIndex + i + 1;

                description += `**${rank}. ${name}** — ${entry.summits} summit stamps\n`;
            }

            // If there are no climbers
            if (description === '') {
                description = 'No climbers have summit stamps yet.';
            }

            // Create embed
            return new EmbedBuilder()
                .setTitle('🏔️ World Expeditions — Leaderboard')
                .setDescription(description)
                .setColor(0x00AEFF)
                .setFooter({
                    text: `Page ${page + 1} of ${totalPages}`
                });
        }

        // Function to create the buttons
        function createButtons(page) {
            const previousButton = new ButtonBuilder()
                .setCustomId('leaderboard_previous')
                .setLabel('Previous')
                .setEmoji('◀️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(page === 0);

            const nextButton = new ButtonBuilder()
                .setCustomId('leaderboard_next')
                .setLabel('Next')
                .setEmoji('▶️')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(page >= totalPages - 1);

            return new ActionRowBuilder()
                .addComponents(previousButton, nextButton);
        }

        // Create the initial embed and buttons
        const embed = await createLeaderboardEmbed(currentPage);
        const buttons = createButtons(currentPage);

        await interaction.reply({
            embeds: [embed],
            components: [buttons]
        });

        // Get the leaderboard message
        const message = await interaction.fetchReply();

        // Create button collector
        const collector = message.createMessageComponentCollector({
            time: 5 * 60 * 1000 // 5 minutes
        });

        // Handle button clicks
        collector.on('collect', async buttonInteraction => {

            // Move to previous page
            if (buttonInteraction.customId === 'leaderboard_previous') {
                if (currentPage > 0) {
                    currentPage--;
                }
            }

            // Move to next page
            if (buttonInteraction.customId === 'leaderboard_next') {
                if (currentPage < totalPages - 1) {
                    currentPage++;
                }
            }

            // Create updated embed and buttons
            const updatedEmbed = await createLeaderboardEmbed(currentPage);
            const updatedButtons = createButtons(currentPage);

            // Update the leaderboard message
            await buttonInteraction.update({
                embeds: [updatedEmbed],
                components: [updatedButtons]
            });
        });

        // When the collector expires, disable both buttons
        collector.on('end', async () => {
            const disabledButtons = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('leaderboard_previous_disabled')
                        .setLabel('Previous')
                        .setEmoji('◀️')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(true),

                    new ButtonBuilder()
                        .setCustomId('leaderboard_next_disabled')
                        .setLabel('Next')
                        .setEmoji('▶️')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(true)
                );

            await interaction.editReply({
                components: [disabledButtons]
            }).catch(() => {});
        });
    }
};
