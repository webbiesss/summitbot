const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stampupdate')
        .setDescription('Update a climber’s summit stamps')
        .addUserOption(option =>
            option.setName('climber')
                .setDescription('The climber to update')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Number of summit stamps to add')
                .setRequired(true)),

    async execute(interaction) {

        // ==========================================
        // REQUIRED ROLE FOR /STAMPUPDATE
        // ==========================================
        const requiredRoleId = '1528823041507856404';

        // Get the member who ran the command
        const commandUser = interaction.member;

        // Get the required role
        const requiredRole = interaction.guild.roles.cache.get(requiredRoleId);

        // If the role ID is invalid, log an error
        if (!requiredRole) {
            console.error('The required role for /stampupdate could not be found.');
            return interaction.reply({
                content: 'There is a configuration error with this command.',
                ephemeral: true
            });
        }

        // Check if the user has the required role or a role higher than it
        const hasPermission = commandUser.roles.cache.some(
            role => role.position >= requiredRole.position
        );

        // If they don't have permission, send an ephemeral embed
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
        // STAMPUPDATE COMMAND
        // ==========================================

        const climber = interaction.options.getUser('climber');
        const amount = interaction.options.getInteger('amount');

        const dbPath = path.join(__dirname, '..', 'data', 'climbers.json');
        let db = JSON.parse(fs.readFileSync(dbPath));

        if (!db[climber.id]) {
            db[climber.id] = { summits: 0 };
        }

        db[climber.id].summits += amount;
        const total = db[climber.id].summits;

        fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));

        const thresholds = [
            { amount: 5, role: '1528831587117043793' },  // beginner
            { amount: 10, role: '1528831779690250381' }, // novice
            { amount: 20, role: '1528831838309580810' }, // experienced
            { amount: 50, role: '1528831960363831356' }, // expert
            { amount: 100, role: '1528832027086950550' } // talented
        ];

        const member = await interaction.guild.members.fetch(climber.id);

        for (const t of thresholds) {
            if (total >= t.amount) {
                await member.roles.add(t.role).catch(() => {});
            }
        }

        const embed = new EmbedBuilder()
            .setTitle('World Expeditions Guide Department')
            .setDescription(`Updated ${climber} summit stamps by **${amount}**.`)
            .setColor(0x00AEFF)
            .setFooter({
                text: `Logged by ${interaction.user.username} • ${new Date().toISOString()}`
            });

        await interaction.reply({ embeds: [embed] });
    }
};