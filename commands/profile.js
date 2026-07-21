const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('View your climbing profile')
        .addUserOption(option =>
            option.setName('climber')
                .setDescription('View another climber’s profile')
                .setRequired(false)),

    async execute(interaction) {
        const climber = interaction.options.getUser('climber') || interaction.user;

        const dbPath = path.join(__dirname, '..', 'data', 'climbers.json');
        let db = JSON.parse(fs.readFileSync(dbPath));

        const summits = db[climber.id]?.summits || 0;

        let levelText = '';
        if (summits >= 100) levelText = 'Talented Climber';
        else if (summits >= 50) levelText = 'Expert Climber';
        else if (summits >= 20) levelText = 'Experienced Climber';
        else if (summits >= 10) levelText = 'Novice Climber';
        else if (summits >= 5) levelText = 'Beginner Climber';
        else levelText = 'Unranked';

        const embed = new EmbedBuilder()
            .setTitle('World Expeditions — User Profile')
            .addFields(
                {
                    name: 'Summit Stamps',
                    value: `You currently have **${summits}** summit stamps ${climber}`,
                    inline: false
                },
                {
                    name: 'Level',
                    value: levelText,
                    inline: false
                }
            )
            .setColor(0x00AEFF);

        await interaction.reply({ embeds: [embed] });
    }
};
