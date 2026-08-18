const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const REQUIRED_ROLE_ID = '827956660638318592';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('transferrobloxuser')
        .setDescription('Transfer a Roblox user to a new Discord user.')
        .addStringOption(option =>
            option
                .setName('username')
                .setDescription('Roblox username')
                .setRequired(true)
        )
        .addUserOption(option =>
            option
                .setName('discorduser')
                .setDescription('New Discord user')
                .setRequired(true)
        ),

    async execute(interaction) {
        // Permission check
        const commandUser = interaction.member;
        const requiredRole = interaction.guild.roles.cache.get(REQUIRED_ROLE_ID);
        if (!requiredRole) {
            console.error('Required role not found.');
            return interaction.reply({ content: 'There is a configuration error with this command.', ephemeral: true });
        }

        const hasPermission = commandUser.roles.cache.has(REQUIRED_ROLE_ID)
            || (commandUser.roles.highest && commandUser.roles.highest.position >= requiredRole.position);

        if (!hasPermission) {
            const permissionEmbed = new EmbedBuilder()
                .setTitle('World Expeditions')
                .setDescription('You do not have permission to run that command.')
                .setColor(0xFF0000);
            return interaction.reply({ embeds: [permissionEmbed], ephemeral: true });
        }

        // Get options
        const usernameRaw = interaction.options.getString('username');
        const newdiscorduser = interaction.options.getUser('discorduser');

        if (!usernameRaw) {
            return interaction.reply({ content: 'Username is required.', ephemeral: true });
        }
        if (!newdiscorduser) {
            return interaction.reply({ content: 'New Discord user not found.', ephemeral: true });
        }

        const username = usernameRaw.trim();
        const dbPath = path.join(__dirname, '..', 'data', 'robloxusers.json');

        // Load database
        let users = [];
        try {
            if (fs.existsSync(dbPath)) {
                const raw = fs.readFileSync(dbPath, 'utf8');
                users = JSON.parse(raw || '[]');
                if (!Array.isArray(users)) users = [];
            }
        } catch (err) {
            console.error('Failed to read or parse robloxusers.json', err);
            return interaction.reply({ content: 'Failed to read the climber database.', ephemeral: true });
        }

        // Find user
        const userIndex = users.findIndex(u => (u.username || '').toLowerCase() === username.toLowerCase());

        if (userIndex === -1) {
            const embed = new EmbedBuilder()
                .setTitle('World Expeditions Guide Department')
                .setDescription(
                    `❌ Roblox user **${username}** was not found in the climber database.\n\n` +
                    `Use **/robloxstamplist** to view all registered Roblox climbers.\n\n` +
                    `If the climber is not listed, add summit stamps to their discord profile using **/stampupdate**.`
                )
                .setColor(0xFF0000);
            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        // Transfer ownership
        users[userIndex].discordId = newdiscorduser.id;

        // Save database
        try {
            fs.writeFileSync(dbPath, JSON.stringify(users, null, 2), 'utf8');
        } catch (err) {
            console.error('Failed to write robloxusers.json', err);
            return interaction.reply({ content: 'Failed to save the updated climber database.', ephemeral: true });
        }

        const successEmbed = new EmbedBuilder()
            .setTitle('World Expeditions Guide Department')
            .setDescription(`✅ Successfully transferred **${username}** to <@${newdiscorduser.id}>.`)
            .setColor(0x00FF00);

        return interaction.reply({ embeds: [successEmbed] });
    }
};
