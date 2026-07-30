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

         // Determine current level and next level
            // Level requirements
        let improvingclimber = 2;
        let intermediateclimber = 5;
        let experiencedclimber = 9;
        let advancedclimber = 14;
        let eliteclimber = 20;

        // Determine current level and next level
        let levelText;
        let currentLevelRequirement;
        let nextLevelRequirement;
        let nextLevelText;

        if (summits >= eliteclimber) {
            levelText = 'Elite Climber';
            currentLevelRequirement = eliteclimber;
            nextLevelRequirement = eliteclimber;
            nextLevelText = 'Maximum Level reached';
        } else if (summits >= advancedclimber) {
            levelText = 'Advanced Climber';
            currentLevelRequirement = advancedclimber;
            nextLevelRequirement = eliteclimber;
            nextLevelText = 'Elite Climber';
        } else if (summits >= experiencedclimber) {
            levelText = 'Experienced Climber';
            currentLevelRequirement = experiencedclimber;
            nextLevelRequirement = advancedclimber;
            nextLevelText = 'Advanced Climber';
        } else if (summits >= intermediateclimber) {
            levelText = 'Intermediate Climber';
            currentLevelRequirement = intermediateclimber;
            nextLevelRequirement = experiencedclimber;
            nextLevelText = 'Experienced Climber';
        } else if (summits >= improvingclimber) {
            levelText = 'Improving Climber';
            currentLevelRequirement = improvingclimber;
            nextLevelRequirement = intermediateclimber;
            nextLevelText = 'Intermediate Climber';
        } else {
            levelText = 'Climber';
            currentLevelRequirement = 0;
            nextLevelRequirement = improvingclimber;
            nextLevelText = 'Improving Climber';
        }

        // Calculate progression
        let progressBar;
        let progressPercentage;
        let stampsNeeded;

        if (summits >= 20) {
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
                    value: summits >= 100
                        ? `🏆 Maximum level reached!\n**${progressBar}**`
                        : `**${progressPercentage}%** toward **${nextLevelText}**\n**${progressBar}**\n\nYou need **${stampsNeeded}** more summit stamp${stampsNeeded === 1 ? '' : 's'} to reach **${nextLevelText}**.`,
                    inline: false
                }
            )
            .setColor(0x00AEFF);

        await interaction.reply({ embeds: [embed] });
    }
};
