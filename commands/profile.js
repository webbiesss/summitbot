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

        const progressionLevels = [
            { threshold: 0, name: 'Climber' },
            { threshold: 2, name: 'Improving Climber' },
            { threshold: 5, name: 'Intermediate Climber' },
            { threshold: 9, name: 'Experienced Climber' },
            { threshold: 14, name: 'Advanced Climber' },
            { threshold: 20, name: 'Elite Climber' },
            { threshold: 50, name: 'fox' },
            { threshold: 75, name: 'Master Climber' },
            { threshold: 100, name: 'Worldian Sherpa' },
            { threshold: 350, name: 'brown bear' },
            { threshold: 500, name: 'Peak Ascender' },
            { threshold: 750, name: 'snow leopard' },
            { threshold: 1000, name: 'Worldian Grand Ascender' },
            { threshold: 1500, name: 'golden eagle' },
            { threshold: 2500, name: 'alpine ibex(G.O.AT)' },
            { threshold: 3000, name: 'World Zenith Conqueror' }
        ];

        let currentLevelIndex = progressionLevels.length - 1;

        while (
            currentLevelIndex > 0 &&
            summits < progressionLevels[currentLevelIndex].threshold
        ) {
            currentLevelIndex--;
        }

        const currentLevel = progressionLevels[currentLevelIndex];
        const nextLevel = progressionLevels[currentLevelIndex + 1];
        const levelText = currentLevel.name;
        const currentLevelRequirement = currentLevel.threshold;
        const nextLevelRequirement = nextLevel?.threshold;
        const nextLevelText = nextLevel?.name;

        // Calculate progression
        let progressBar;
        let progressPercentage;
        let stampsNeeded;

        if (!nextLevel) {
            progressBar = '██████████';
            progressPercentage = 100;
            stampsNeeded = 0;
        } else {
            const progressRange = nextLevelRequirement - currentLevelRequirement;
            const progressAmount = summits - currentLevelRequirement;

            progressPercentage = Math.floor(
                (progressAmount / progressRange) * 100
            );

            const filledBlocks = Math.floor(progressPercentage / 10);
            const emptyBlocks = 10 - filledBlocks;

            progressBar =
                '█'.repeat(filledBlocks) +
                '░'.repeat(emptyBlocks);

            stampsNeeded = nextLevelRequirement - summits;
        }

        const embed = new EmbedBuilder()
            .setTitle('World Expeditions — User Profile')
            .addFields(
                {
                    name: 'Climber',
                    value: `${climber}`,
                    inline: false
                },
                {
                    name: 'Summit Stamps',
                    value: `You currently have **${summits}** summit stamps`,
                    inline: false
                },
                {
                    name: 'Level',
                    value: levelText,
                    inline: false
                },
                {
                    name: 'Level Progress',
                    value: !nextLevel
                        ? `🏆 Maximum level reached!`
                        : `**${progressPercentage}%** toward **${nextLevelText}**\n**${progressBar}**\n\nYou need **${stampsNeeded}** more summit stamp${stampsNeeded === 1 ? '' : 's'} to reach **${nextLevelText}**.`,
                    inline: false
                }
            )
            .setColor(0x00AEFF);

        await interaction.reply({ embeds: [embed] });
    }
};
