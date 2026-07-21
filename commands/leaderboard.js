const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
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
        const leaderboard = Object.entries(db)
            .map(([userId, data]) => ({
                userId,
                summits: data.summits || 0
            }))
            .sort((a, b) => b.summits - a.summits)
            .slice(0, 10); // Top 10

        // Build leaderboard text
        let description = '';

        for (let i = 0; i < leaderboard.length; i++) {
            const entry = leaderboard[i];
            const user = await interaction.guild.members.fetch(entry.userId).catch(() => null);

            const name = user ? user.user.username : `Unknown User (${entry.userId})`;

            description += `**${i + 1}. ${name}** — ${entry.summits} summit stamps\n`;
        }

        if (description === '') {
            description = 'No climbers have summit stamps yet.';
        }

        // Build embed
        const embed = new EmbedBuilder()
            .setTitle('🏔️ World Expeditions — Leaderboard')
            .setDescription(description)
            .setColor(0x00AEFF);

        await interaction.reply({ embeds: [embed] });
    }
};
